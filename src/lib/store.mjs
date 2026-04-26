import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function getGitRoot() {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    } catch {
        console.error("Not a git repository.");
        process.exit(1);
    }
}

const TOOL_EMOJIS = { copilot: "🪁", cursor: "🖱️", claude: "🔶" };

export function formatTool(info) {
    const emoji = TOOL_EMOJIS[info.tool] || "🤖";
    return `${emoji} › ${info.model}`;
}

// Load all ai-blame data. Returns Map<sha, Map<file, { lines, model, tool }>>
export function loadCommitData(gitRoot) {
    const commitsDir = join(gitRoot, ".git", "ai-blame", "commits");
    const data = new Map();

    let files;
    try {
        files = readdirSync(commitsDir);
    } catch {
        return data;
    }

    for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sha = file.replace(".jsonl", "");
        const content = readFileSync(join(commitsDir, file), "utf-8");
        const fileMap = parseJsonl(content);
        if (fileMap.size > 0) data.set(sha, fileMap);
    }

    // Also check pending (uncommitted edits)
    try {
        const pending = readFileSync(join(gitRoot, ".git", "ai-blame", "pending.jsonl"), "utf-8");
        const fileMap = parseJsonl(pending);
        if (fileMap.size > 0) data.set("pending", fileMap);
    } catch { /* no pending */ }

    return data;
}

function parseJsonl(content) {
    const fileMap = new Map();
    for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        const existing = fileMap.get(record.file) || { lines: [], model: record.model, tool: record.tool || "copilot" };
        existing.lines.push(...record.lines);
        fileMap.set(record.file, existing);
    }
    return fileMap;
}

// Count total AI-attributed lines for a commit's file data
export function countAiLines(fileInfo) {
    let count = 0;
    for (const [start, end] of fileInfo.lines) {
        count += end - start + 1;
    }
    return count;
}
