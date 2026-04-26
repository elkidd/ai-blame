import { execFileSync } from "node:child_process";
import { getGitRoot, loadCommitData, countAiLines } from "../../lib/store.mjs";

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export function log(options = {}) {
    const gitRoot = getGitRoot();
    const commitData = loadCommitData(gitRoot);

    const limit = options.limit || 30;

    let gitLog;
    try {
        gitLog = execFileSync(
            "git", ["log", `--max-count=${limit}`, "--format=%H %h %s"],
            { encoding: "utf-8", cwd: gitRoot }
        ).trim();
    } catch (err) {
        console.error(`git log failed: ${err.message}`);
        process.exit(1);
    }

    if (!gitLog) {
        console.log("No commits found.");
        return;
    }

    for (const line of gitLog.split("\n")) {
        const [fullSha, shortSha, ...msgParts] = line.split(" ");
        const msg = msgParts.join(" ");

        const fileMap = commitData.get(fullSha);
        if (fileMap) {
            let totalAi = 0;
            const models = new Set();
            for (const [, info] of fileMap) {
                totalAi += countAiLines(info);
                models.add(info.model);
            }
            const modelStr = [...models].join(", ");
            console.log(`${YELLOW}${shortSha}${RESET} ${msg}  ${CYAN}[AI: ${totalAi} lines - ${modelStr}]${RESET}`);
        } else {
            console.log(`${DIM}${shortSha}${RESET} ${msg}`);
        }
    }
}
