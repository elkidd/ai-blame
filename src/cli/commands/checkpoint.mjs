// ai-blame checkpoint: hooks-based AI attribution tracking.
// Called by Copilot CLI agent hooks (PreToolUse / PostToolUse).
// Reads tool call info from stdin JSON, snapshots files before edits,
// diffs after edits, and writes attribution to pending.jsonl.
//
// Stdin fields use snake_case: tool_name, tool_input, tool_result, result_type.
// Model is resolved from the session's events.jsonl via session_id.

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { diffArrays } from "diff";

const EDIT_TOOLS = new Set(["edit", "create"]);

function gitDir(cwd) {
    try {
        const rel = execFileSync("git", ["rev-parse", "--git-dir"], {
            cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return isAbsolute(rel) ? rel : resolve(cwd, rel);
    } catch {
        return null;
    }
}

function gitRoot(cwd) {
    try {
        return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        }).trim());
    } catch {
        return null;
    }
}

function resolveFilePath(toolInput, cwd) {
    const p = toolInput?.path;
    if (!p) return null;
    return isAbsolute(p) ? p : resolve(cwd, p);
}

function snapshotKey(absPath) {
    return createHash("sha256").update(absPath).digest("hex").slice(0, 16);
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
export function computeChangedLines(before, after) {
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

// Resolve the model name from the session's events.jsonl.
// Reads the last tool.execution_complete event to find the current model.
function resolveModel(sessionId) {
    if (!sessionId) return "unknown";
    const eventsPath = join(
        process.env.HOME, ".copilot", "session-state", sessionId, "events.jsonl"
    );
    if (!existsSync(eventsPath)) return "unknown";

    try {
        const content = readFileSync(eventsPath, "utf-8");
        const lines = content.trimEnd().split("\n");
        // Scan backwards for the most recent model
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const event = JSON.parse(lines[i]);
                const model = event?.data?.model;
                if (model) return model;
            } catch { continue; }
        }
    } catch { /* ignore */ }
    return "unknown";
}

function readStdin() {
    return readFileSync(0, "utf-8");
}

function handlePre(input) {
    const toolName = input.tool_name;
    const toolInput = input.tool_input || {};

    if (!EDIT_TOOLS.has(toolName)) return;

    const cwd = input.cwd || process.cwd();
    const absPath = resolveFilePath(toolInput, cwd);
    if (!absPath) return;

    // Resolve git dir from the file's directory, not cwd
    const fileDir = existsSync(absPath) ? dirname(absPath) : cwd;
    const gd = gitDir(fileDir);
    if (!gd) return;

    const snapshotDir = join(gd, "ai-blame", "snapshots");
    mkdirSync(snapshotDir, { recursive: true });

    const lines = readLines(absPath);
    const key = snapshotKey(absPath);
    const ts = Date.now();

    const snapshotFile = join(snapshotDir, `${key}_${ts}.json`);
    writeFileSync(snapshotFile, JSON.stringify({ path: absPath, lines }));
}

function handlePost(input) {
    const toolName = input.tool_name;
    const toolInput = input.tool_input || {};

    if (!EDIT_TOOLS.has(toolName)) return;

    // Skip failed tool calls
    const result = input.tool_result;
    if (result && result.result_type && result.result_type !== "success") return;

    const cwd = input.cwd || process.cwd();
    const absPath = resolveFilePath(toolInput, cwd);
    if (!absPath) return;

    const fileDir = existsSync(absPath) ? dirname(absPath) : cwd;
    const gd = gitDir(fileDir);
    if (!gd) return;

    const root = gitRoot(fileDir);
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

    // Resolve model from session events
    const sessionId = input.session_id || process.env.COPILOT_AGENT_SESSION_ID;
    const model = resolveModel(sessionId);

    const record = {
        file: relativePath,
        lines: changedLines,
        tool: "copilot",
        model,
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
