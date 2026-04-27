import { execFileSync } from "node:child_process";
import { getGitRoot, loadCommitData, countAiLines, formatTool } from "../../lib/store.mjs";

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function stats(commit) {
    const gitRoot = getGitRoot();
    const commitData = loadCommitData(gitRoot);

    if (commitData.size === 0) {
        console.log("No ai-blame data found. Start using the Copilot CLI extension to track AI edits.");
        return;
    }

    if (commit) {
        showCommitStats(commit, commitData, gitRoot);
    } else {
        showOverallStats(commitData);
    }
}

function showCommitStats(commit, commitData, gitRoot) {
    // Resolve short SHA to full
    let fullSha;
    try {
        fullSha = execFileSync("git", ["rev-parse", commit], { encoding: "utf-8", cwd: gitRoot }).trim();
    } catch {
        console.error(`Could not resolve commit: ${commit}`);
        process.exit(1);
    }

    const fileMap = commitData.get(fullSha);
    if (!fileMap) {
        console.log(`No ai-blame data for commit ${commit}`);
        return;
    }

    console.log(`${BOLD}AI attribution for ${commit.slice(0, 8)}${RESET}\n`);

    let totalAi = 0;
    const models = new Map();

    for (const [file, info] of fileMap) {
        const aiLines = countAiLines(info);
        totalAi += aiLines;
        const key = formatTool(info);
        models.set(key, (models.get(key) || 0) + aiLines);
        console.log(`  ${CYAN}${String(aiLines).padStart(4)} lines${RESET}  ${file}  ${DIM}(${formatTool(info)})${RESET}`);
    }

    console.log(`\n${BOLD}Total: ${totalAi} AI-attributed lines${RESET}`);
    if (models.size > 0) {
        console.log(`${DIM}Models:${RESET}`);
        for (const [model, lines] of models) {
            console.log(`  ${model}: ${lines} lines`);
        }
    }
}

function showOverallStats(commitData) {
    console.log(`${BOLD}AI attribution across all tracked commits${RESET}\n`);

    let totalAi = 0;
    let totalCommits = 0;
    const models = new Map();
    const fileStats = new Map();

    for (const [sha, fileMap] of commitData) {
        totalCommits++;
        for (const [file, info] of fileMap) {
            const aiLines = countAiLines(info);
            totalAi += aiLines;
            const key = formatTool(info);
            models.set(key, (models.get(key) || 0) + aiLines);
            fileStats.set(file, (fileStats.get(file) || 0) + aiLines);
        }
    }

    // Top files by AI lines
    const sortedFiles = [...fileStats.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`${BOLD}Top files by AI lines:${RESET}`);
    for (const [file, lines] of sortedFiles.slice(0, 15)) {
        console.log(`  ${CYAN}${String(lines).padStart(4)} lines${RESET}  ${file}`);
    }

    console.log(`\n${BOLD}AI lines by model:${RESET}`);
    const multipleModels = models.size > 1;
    for (const [model, lines] of [...models.entries()].sort((a, b) => b[1] - a[1])) {
        if (multipleModels) {
            const pct = ((lines / totalAi) * 100).toFixed(1);
            console.log(`  ${model}: ${lines} lines (${pct}%)`);
        } else {
            console.log(`  ${model}: ${lines} lines`);
        }
    }

    // Count total lines and surviving AI lines
    const root = getGitRoot();
    let totalLines = 0;
    const fileLengths = new Map();
    try {
        const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8", cwd: root });
        const files = output.split("\0").filter(Boolean);
        for (const file of files) {
            try {
                const content = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf-8", cwd: root });
                const len = content.split("\n").length;
                totalLines += len;
                fileLengths.set(file, len);
            } catch { /* binary or missing */ }
        }
    } catch { /* ignore */ }

    // Merge all AI line ranges per file and clamp to current file length
    const mergedRanges = new Map();
    for (const [, fileMap] of commitData) {
        for (const [file, info] of fileMap) {
            const existing = mergedRanges.get(file) || [];
            existing.push(...info.lines);
            mergedRanges.set(file, existing);
        }
    }

    let survivingAi = 0;
    for (const [file, ranges] of mergedRanges) {
        const fileLen = fileLengths.get(file);
        if (fileLen == null) continue; // file deleted
        // Merge overlapping ranges, clamp to file length
        const sorted = ranges.map(([s, e]) => [s, Math.min(e, fileLen)]).filter(([s, e]) => s <= fileLen).sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [s, e] of sorted) {
            if (merged.length && s <= merged[merged.length - 1][1] + 1) {
                merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
            } else {
                merged.push([s, e]);
            }
        }
        for (const [s, e] of merged) survivingAi += e - s + 1;
    }

    if (totalLines > 0) {
        const pct = ((survivingAi / totalLines) * 100).toFixed(2);
        console.log(`\n${DIM}${totalCommits} commits tracked, ${totalAi} AI lines written, ${survivingAi} still present (${pct}% of codebase)${RESET}`);
    } else {
        console.log(`\n${DIM}${totalCommits} commits tracked, ${totalAi} total AI-attributed lines${RESET}`);
    }
}
