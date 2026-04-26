import { readFileSync } from "node:fs";
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
    const data = new Map();

    // Read from git notes
    loadFromNotes(gitRoot, data);

    // Pending (uncommitted edits)
    try {
        const pending = readFileSync(join(gitRoot, ".git", "ai-blame", "pending.jsonl"), "utf-8");
        const fileMap = parseJsonl(pending);
        if (fileMap.size > 0) data.set("pending", fileMap);
    } catch { /* no pending */ }

    return data;
}

function loadFromNotes(gitRoot, data) {
    try {
        // Bulk read: git log with notes inlined
        const output = execFileSync("git", [
            "log", "--format=%H%n%N", "--notes=ai-blame", "--all",
        ], { encoding: "utf-8", cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 });

        let currentSha = null;
        let noteLines = [];

        for (const line of output.split("\n")) {
            // SHA lines are exactly 40 hex chars
            if (/^[0-9a-f]{40}$/.test(line)) {
                if (currentSha && noteLines.length > 0) {
                    const content = noteLines.join("\n");
                    const fileMap = parseJsonl(content);
                    if (fileMap.size > 0 && !data.has(currentSha)) {
                        data.set(currentSha, fileMap);
                    }
                }
                currentSha = line;
                noteLines = [];
            } else if (line.trim()) {
                noteLines.push(line);
            }
        }
        // Last commit
        if (currentSha && noteLines.length > 0) {
            const content = noteLines.join("\n");
            const fileMap = parseJsonl(content);
            if (fileMap.size > 0 && !data.has(currentSha)) {
                data.set(currentSha, fileMap);
            }
        }
    } catch { /* no notes ref yet */ }
}

function parseJsonl(content) {
    const fileMap = new Map();
    for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
            const record = JSON.parse(line);
            const existing = fileMap.get(record.file) || { lines: [], model: record.model, tool: record.tool || "copilot" };
            existing.lines.push(...record.lines);
            fileMap.set(record.file, existing);
        } catch { /* skip non-JSON lines */ }
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
