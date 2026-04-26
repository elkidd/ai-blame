// ai-blame: Copilot CLI extension for AI code provenance tracking.
// Captures which lines are written by AI (with model info) on every edit/create.
// Data is stored in .git/ai-blame/pending.jsonl until committed.

import { joinSession } from "@github/copilot-sdk/extension";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve, isAbsolute } from "node:path";
import { diffArrays } from "diff";

const EDIT_TOOLS = new Set(["edit", "create"]);

// --- Model tracking ---
let currentModel = "unknown";

// --- Per-file snapshot stack ---
// Map<absolutePath, Array<{ lines: string[], model: string }>>
// Stack handles overlapping edits to the same file.
const snapshotStacks = new Map();

// --- Git root cache ---
const gitRootCache = new Map();

function gitRoot(dir) {
    if (gitRootCache.has(dir)) return gitRootCache.get(dir);
    return new Promise((resolve_) => {
        execFile("git", ["rev-parse", "--show-toplevel"], { cwd: dir }, (err, stdout) => {
            const root = err ? null : stdout.trim();
            gitRootCache.set(dir, root);
            resolve_(root);
        });
    });
}

function resolveFilePath(toolArgs, cwd) {
    const p = typeof toolArgs === "string" ? toolArgs : toolArgs?.path;
    if (!p) return null;
    return isAbsolute(p) ? p : resolve(cwd, p);
}

async function readLines(path) {
    try {
        const content = await readFile(path, "utf-8");
        return content.split("\n");
    } catch (err) {
        if (err.code === "ENOENT") return []; // file doesn't exist yet (create tool)
        throw err;
    }
}

// Compute which lines in `after` are new or changed (AI-authored).
// Uses LCS-based diff to correctly handle insertions, deletions, and replacements.
// Returns array of [startLine, endLine] (1-based, inclusive) in after-file coordinates.
function computeChangedLines(before, after) {
    const changes = diffArrays(before, after);
    const ranges = [];
    let afterLine = 1; // 1-based line number in after
    let rangeStart = null;

    for (const change of changes) {
        if (change.removed) {
            // Lines only in before - skip, they don't exist in after
            continue;
        }

        if (change.added) {
            // New/changed lines in after - these are AI-authored
            const start = afterLine;
            const end = afterLine + change.count - 1;
            // Merge with previous range if contiguous
            if (rangeStart !== null && start === ranges[ranges.length - 1]?.[1] + 1) {
                ranges[ranges.length - 1][1] = end;
            } else {
                ranges.push([start, end]);
            }
            afterLine += change.count;
        } else {
            // Unchanged lines
            afterLine += change.count;
        }
    }

    return ranges;
}

async function writeRecord(absPath, lines, model) {
    const dir = dirname(absPath);
    const root = await gitRoot(dir);
    if (!root) return;

    const aiBlameDir = `${root}/.git/ai-blame`;
    await mkdir(aiBlameDir, { recursive: true });

    const relativePath = absPath.startsWith(root + "/")
        ? absPath.slice(root.length + 1)
        : absPath;

    const record = {
        file: relativePath,
        lines,
        model,
        timestamp: new Date().toISOString(),
    };

    await appendFile(`${aiBlameDir}/pending.jsonl`, JSON.stringify(record) + "\n");
}

// --- Session ---

const session = await joinSession({
    hooks: {
        onPreToolUse: async (input) => {
            if (!EDIT_TOOLS.has(input.toolName)) return;
            const path = resolveFilePath(input.toolArgs, input.cwd);
            if (!path) return;

            const snapshot = { lines: await readLines(path), model: currentModel };
            const stack = snapshotStacks.get(path) || [];
            stack.push(snapshot);
            snapshotStacks.set(path, stack);
        },

        onPostToolUse: async (input) => {
            if (!EDIT_TOOLS.has(input.toolName)) return;
            const path = resolveFilePath(input.toolArgs, input.cwd);
            if (!path) return;

            // Always pop the snapshot to avoid leaks
            const stack = snapshotStacks.get(path) || [];
            const snapshot = stack.pop();
            if (stack.length === 0) snapshotStacks.delete(path);

            if (!snapshot) return;
            if (input.toolResult?.resultType === "error") return;

            try {
                const after = await readLines(path);
                const changedLines = computeChangedLines(snapshot.lines, after);
                if (changedLines.length === 0) return;
                await writeRecord(path, changedLines, snapshot.model);
            } catch {
                // Don't crash the extension on write failures
            }
        },
    },
});

// Track model from session events
session.on("session.start", (event) => {
    if (event.data.selectedModel) {
        currentModel = event.data.selectedModel;
    }
});

session.on("session.resume", (event) => {
    if (event.data.selectedModel) {
        currentModel = event.data.selectedModel;
    }
});

session.on("session.model_change", (event) => {
    currentModel = event.data.newModel;
});

await session.log("ai-blame extension active", { level: "info" });
