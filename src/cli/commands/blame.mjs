import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getGitRoot, loadCommitData } from "../../lib/store.mjs";


// Check if a line number falls within any AI-attributed range
function findAiAttribution(commitData, sha, file, lineNo) {
    const fileMap = commitData.get(sha);
    if (!fileMap) return null;
    const info = fileMap.get(file);
    if (!info) return null;

    for (const [start, end] of info.lines) {
        if (lineNo >= start && lineNo <= end) return info.model;
    }
    return null;
}

// Parse git blame --porcelain output
function parseBlame(output) {
    const lines = output.split("\n");
    const result = [];
    let currentSha = null;
    let currentLine = null;
    const authors = new Map();
    const dates = new Map();

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line) { i++; continue; }

        // Header line: SHA origLine finalLine [groupCount]
        const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
        if (headerMatch) {
            currentSha = headerMatch[1];
            currentLine = parseInt(headerMatch[2]);
            i++;

            // Read metadata lines until we hit the content line (starts with \t)
            while (i < lines.length && !lines[i].startsWith("\t")) {
                const metaLine = lines[i];
                if (metaLine.startsWith("author ")) {
                    authors.set(currentSha, metaLine.slice(7));
                } else if (metaLine.startsWith("author-time ")) {
                    const ts = parseInt(metaLine.slice(12));
                    dates.set(currentSha, new Date(ts * 1000).toISOString().slice(0, 10));
                }
                i++;
            }

            // Content line (starts with \t)
            if (i < lines.length && lines[i].startsWith("\t")) {
                result.push({
                    sha: currentSha,
                    lineNo: currentLine,
                    content: lines[i].slice(1),
                    author: authors.get(currentSha) || "?",
                    date: dates.get(currentSha) || "?",
                });
                i++;
            }
        } else {
            i++;
        }
    }

    return result;
}

// ANSI colors
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

export function blame(file) {
    const gitRoot = getGitRoot();

    // Get relative path for matching
    const fullPath = file.startsWith("/") ? file : join(process.cwd(), file);
    const relativePath = fullPath.startsWith(gitRoot + "/")
        ? fullPath.slice(gitRoot.length + 1)
        : file;

    let blameOutput;
    try {
        blameOutput = execFileSync("git", ["blame", "--porcelain", file], { encoding: "utf-8", cwd: gitRoot });
    } catch (err) {
        console.error(`git blame failed: ${err.message}`);
        process.exit(1);
    }

    const commitData = loadCommitData(gitRoot);
    const blameLines = parseBlame(blameOutput);

    // Compute column widths
    const maxLineNo = blameLines.length > 0 ? blameLines[blameLines.length - 1].lineNo : 1;
    const lineNoWidth = String(maxLineNo).length;
    const shortShaWidth = 8;
    const maxAuthor = Math.min(20, Math.max(...blameLines.map((l) => l.author.length)));

    let aiLineCount = 0;

    for (const line of blameLines) {
        const shortSha = line.sha.slice(0, shortShaWidth);
        const author = line.author.slice(0, maxAuthor).padEnd(maxAuthor);
        const lineNo = String(line.lineNo).padStart(lineNoWidth);
        const model = findAiAttribution(commitData, line.sha, relativePath, line.lineNo);

        if (model) {
            aiLineCount++;
            const tag = `${CYAN}[${model}]${RESET}`;
            console.log(`${DIM}${shortSha}${RESET} (${BOLD}${author}${RESET} ${line.date} ${lineNo}) ${line.content}  ${tag}`);
        } else {
            console.log(`${DIM}${shortSha}${RESET} (${author} ${line.date} ${lineNo}) ${line.content}`);
        }
    }

    // Summary
    const total = blameLines.length;
    if (total > 0) {
        const pct = ((aiLineCount / total) * 100).toFixed(1);
        console.log(`\n${DIM}--- ${aiLineCount}/${total} lines (${pct}%) have AI attribution ---${RESET}`);
    }
}
