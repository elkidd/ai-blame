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

    // Count total lines in tracked files
    let totalLines = 0;
    try {
        const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8", cwd: getGitRoot() });
        const files = output.split("\0").filter(Boolean);
        for (const file of files) {
            try {
                const content = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf-8", cwd: getGitRoot() });
                totalLines += content.split("\n").length;
            } catch { /* binary or missing */ }
        }
    } catch { /* ignore */ }

    const summary = totalLines > 0
        ? `${totalCommits} commits tracked, ${totalAi} AI-attributed lines / ${totalLines.toLocaleString()} total (${((totalAi / totalLines) * 100).toFixed(2)}%)`
        : `${totalCommits} commits tracked, ${totalAi} total AI-attributed lines`;
    console.log(`\n${DIM}${summary}${RESET}`);
}
