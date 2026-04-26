// ai-blame checkpoint: hooks-based AI attribution tracking.
// Called by Copilot CLI agent hooks (PreToolUse / PostToolUse).
// Reads tool call info from stdin JSON, snapshots files before edits,
// diffs after edits, and writes attribution to pending.jsonl.

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { diffArrays } from "diff";

const EDIT_TOOLS = new Set(["edit", "create"]);

function gitDir(cwd) {
    try {
        const rel = execFileSync("git", ["rev-parse", "--git-dir"], {
            cwd,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        // git returns relative path — resolve against cwd
        return isAbsolute(rel) ? rel : resolve(cwd, rel);
    } catch {
        return null;
    }
}

function gitRoot(cwd) {
    try {
        return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim());
    } catch {
        return null;
    }
}

function resolveFilePath(toolArgs, cwd) {
    const p = toolArgs?.path;
    if (!p) return null;
    return isAbsolute(p) ? p : resolve(cwd, p);
}

function snapshotKey(absPath) {
    const hash = createHash("sha256").update(absPath).digest("hex").slice(0, 16);
    return hash;
}

function readLines(path) {
    try {
        return readFileSync(path, "utf-8").split("\n");
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
}

// Compute which lines in `after` are new or changed (AI-authored).
function computeChangedLines(before, after) {
    const changes = diffArrays(before, after);
    const ranges = [];
    let afterLine = 1;

    for (const change of changes) {
        if (change.removed) continue;

        if (change.added) {
            const start = afterLine;
            const end = afterLine + change.count - 1;
            if (ranges.length > 0 && start === ranges[ranges.length - 1][1] + 1) {
                ranges[ranges.length - 1][1] = end;
            } else {
                ranges.push([start, end]);
            }
            afterLine += change.count;
        } else {
            afterLine += change.count;
        }
    }

    return ranges;
}

function readStdin() {
    return readFileSync(0, "utf-8");
}

function handlePre(input) {
    const toolArgs = typeof input.toolArgs === "string" ? JSON.parse(input.toolArgs) : input.toolArgs;
    const toolName = input.toolName;

    if (!EDIT_TOOLS.has(toolName)) return;

    const cwd = input.cwd || process.cwd();
    const absPath = resolveFilePath(toolArgs, cwd);
    if (!absPath) return;

    const gd = gitDir(cwd);
    if (!gd) return;

    const snapshotDir = join(gd, "ai-blame", "snapshots");
    mkdirSync(snapshotDir, { recursive: true });

    const lines = readLines(absPath);
    const key = snapshotKey(absPath);
    const ts = Date.now();

    // Stack-based: use timestamp suffix for LIFO ordering
    const snapshotFile = join(snapshotDir, `${key}_${ts}.json`);
    writeFileSync(snapshotFile, JSON.stringify({ path: absPath, lines }));
}

function handlePost(input) {
    const toolArgs = typeof input.toolArgs === "string" ? JSON.parse(input.toolArgs) : input.toolArgs;
    const toolName = input.toolName;

    if (!EDIT_TOOLS.has(toolName)) return;

    // Skip failed tool calls
    const result = input.toolResult;
    if (result && result.resultType && result.resultType !== "success") return;

    const cwd = input.cwd || process.cwd();
    const absPath = resolveFilePath(toolArgs, cwd);
    if (!absPath) return;

    const gd = gitDir(cwd);
    if (!gd) return;

    const root = gitRoot(cwd);
    if (!root) return;

    // Find the most recent snapshot for this file (LIFO pop)
    const snapshotDir = join(gd, "ai-blame", "snapshots");
    const key = snapshotKey(absPath);

    let snapshotFiles;
    try {
        snapshotFiles = readdirSync(snapshotDir)
            .filter(f => f.startsWith(key + "_") && f.endsWith(".json"))
            .sort()
            .reverse();
    } catch {
        return;
    }

    if (snapshotFiles.length === 0) return;

    const latestFile = join(snapshotDir, snapshotFiles[0]);
    let snapshot;
    try {
        snapshot = JSON.parse(readFileSync(latestFile, "utf-8"));
    } catch {
        return;
    }

    // Clean up this snapshot
    try { unlinkSync(latestFile); } catch { /* ignore */ }

    const after = readLines(absPath);
    const changedLines = computeChangedLines(snapshot.lines, after);
    if (changedLines.length === 0) return;

    const relativePath = absPath.startsWith(root + "/")
        ? absPath.slice(root.length + 1)
        : absPath;

    const record = {
        file: relativePath,
        lines: changedLines,
        model: "copilot-cli",
        timestamp: new Date().toISOString(),
    };

    const pendingFile = join(gd, "ai-blame", "pending.jsonl");
    mkdirSync(join(gd, "ai-blame"), { recursive: true });
    appendFileSync(pendingFile, JSON.stringify(record) + "\n");
}

export function checkpoint(mode) {
    try {
        const raw = readStdin();
        if (!raw.trim()) return;
        const input = JSON.parse(raw);

        if (mode === "pre") {
            handlePre(input);
        } else if (mode === "post") {
            handlePost(input);
        }
    } catch {
        // Hooks must never crash or output errors
    }
}
