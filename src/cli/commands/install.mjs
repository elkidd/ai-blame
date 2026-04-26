import { existsSync, mkdirSync, chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../..");

export function install() {
    installGlobalGitHook();
    installCopilotHooks();
}

function installGlobalGitHook() {
    const globalHooksDir = join(process.env.HOME, ".config", "git", "hooks");
    mkdirSync(globalHooksDir, { recursive: true });

    const dispatcherTarget = join(globalHooksDir, "post-commit");
    const hookSource = join(projectRoot, "src", "git", "hooks", "post-commit");
    const hookContent = readFileSync(hookSource, "utf-8");

    writeFileSync(dispatcherTarget, hookContent);
    chmodSync(dispatcherTarget, 0o755);

    // Set core.hooksPath if not already pointing here
    try {
        const current = execFileSync("git", ["config", "--global", "core.hooksPath"], { encoding: "utf-8" }).trim();
        if (current === globalHooksDir) {
            console.log(`  core.hooksPath already set -> ${globalHooksDir}`);
        } else {
            console.log(`  ⚠️  core.hooksPath is ${current} — overriding to ${globalHooksDir}`);
            execFileSync("git", ["config", "--global", "core.hooksPath", globalHooksDir]);
        }
    } catch {
        execFileSync("git", ["config", "--global", "core.hooksPath", globalHooksDir]);
    }

    console.log(`  Installed global post-commit dispatcher -> ${dispatcherTarget}`);
}

function installCopilotHooks() {
    const hooksDir = join(process.env.HOME, ".copilot", "hooks");
    mkdirSync(hooksDir, { recursive: true });

    const hookFile = join(hooksDir, "ai-blame.json");
    const checkpointCmd = `node ${join(projectRoot, "src", "cli", "index.mjs")} checkpoint`;

    const hookConfig = {
        hooks: {
            PreToolUse: [{ type: "command", command: `${checkpointCmd} --pre` }],
            PostToolUse: [{ type: "command", command: `${checkpointCmd} --post` }],
        },
    };

    writeFileSync(hookFile, JSON.stringify(hookConfig, null, 2) + "\n");
    console.log(`  Installed Copilot agent hooks -> ${hookFile}`);
    console.log("  Restart your Copilot CLI session to activate.");
}
