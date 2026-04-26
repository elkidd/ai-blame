import { existsSync, mkdirSync, chmodSync, copyFileSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../..");

export function install() {
    const gitRoot = getGitRoot();
    installGitHook(gitRoot);
    installCopilotHooks();
    ensureGitignore(gitRoot);
}

function getGitRoot() {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    } catch {
        console.error("Not a git repository. Run this from inside a git repo.");
        process.exit(1);
    }
}

function installGitHook(gitRoot) {

    const hooksDir = join(gitRoot, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });

    const hookSource = join(projectRoot, "src", "git", "hooks", "post-commit");
    const hookTarget = join(hooksDir, "post-commit");

    if (existsSync(hookTarget)) {
        console.log(`  Hook already exists at ${hookTarget}`);
        console.log("  To replace it, remove it first and re-run install.");
        return;
    }

    copyFileSync(hookSource, hookTarget);
    chmodSync(hookTarget, 0o755);
    console.log(`  Installed post-commit hook -> ${hookTarget}`);
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

function ensureGitignore(gitRoot) {
    const gitignorePath = join(gitRoot, ".gitignore");
    const entry = ".git/ai-blame/";

    if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, "utf-8");
        if (content.includes(entry)) return;
    }

    appendFileSync(gitignorePath, `\n# ai-blame tracking data\n${entry}\n`);
    console.log(`  Added ${entry} to .gitignore`);
}
