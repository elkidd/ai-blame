#!/usr/bin/env node

import { Command } from "commander";

import { install } from "./commands/install.mjs";
import { blame } from "./commands/blame.mjs";
import { stats } from "./commands/stats.mjs";
import { log } from "./commands/log.mjs";
import { checkpoint } from "./commands/checkpoint.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

const program = new Command();

program
    .name("gitai")
    .description("Track which lines of code were written by AI")
    .version("0.1.0");

program
    .command("blame <file>")
    .description("Show git blame with AI authorship overlay")
    .action((file) => {
        blame(file);
    });

program
    .command("stats [commit]")
    .description("Show AI vs human authorship statistics")
    .action((commit) => {
        stats(commit);
    });

program
    .command("log")
    .description("Show git log with AI involvement markers")
    .option("-n, --limit <number>", "Number of commits to show", "30")
    .action((options) => {
        log({ limit: parseInt(options.limit) });
    });

program
    .command("install")
    .description("Install git hooks and Copilot CLI agent hooks")
    .action(() => {
        console.log("Installing ai-blame...");
        install();
        console.log("Done!");
    });

program
    .command("checkpoint")
    .description("Record AI attribution (called by Copilot CLI hooks)")
    .option("--pre", "PreToolUse handler")
    .option("--post", "PostToolUse handler")
    .action((options) => {
        if (options.pre) checkpoint("pre");
        else if (options.post) checkpoint("post");
    });

function checkInstallation() {
    const hookFile = join(process.env.HOME, ".copilot", "hooks", "ai-blame.json");
    if (!existsSync(hookFile)) {
        console.error("⚠  ai-blame Copilot hooks not installed. Run: gitai install");
    }
}

const cmd = process.argv[2];
if (cmd && !["install", "checkpoint", "help", "--help", "-h", "-V", "--version"].includes(cmd)) {
    checkInstallation();
}

program.parse();
