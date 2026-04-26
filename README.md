# ai-blame

Track which lines of code were written by AI - per line, per commit, per model.

A [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) extension that captures AI edits in real-time, then provides blame, stats, and log commands showing AI vs human authorship.

## Install

```bash
# From source (recommended during development)
git clone https://github.com/elkidd/ai-blame.git
cd ai-blame
npm install
npm link

# Then, in any git repo you want to track:
gitai install
```

## Commands

### `gitai blame <file>`

Annotated blame with AI authorship overlay. AI-authored lines are tagged with the model name in cyan.

```
$ gitai blame src/extension/extension.mjs
a156cdf0 (Miguel   2026-04-25   1) import { readFileSync, ... }
767a7150 (Miguel   2026-04-25   2) import { diffArrays } ...  [claude-opus-4.6]
767a7150 (Miguel   2026-04-25   3) import { join } from ...   [claude-opus-4.6]
...
--- 134/156 lines (85.9%) have AI attribution ---
```

### `gitai stats [commit]`

AI authorship statistics - overall or for a specific commit.

```
$ gitai stats
AI attribution across all tracked commits

Top files by AI lines:
  134 lines  src/extension/extension.mjs
   42 lines  src/cli/commands/blame.mjs
   18 lines  src/lib/store.mjs

Models:
  claude-opus-4.6: 194 lines (100.0%)

6 commits tracked, 194 total AI-attributed lines

$ gitai stats HEAD
AI attribution for 7aaf4c2

  42 lines  src/cli/commands/stats.mjs  (claude-opus-4.6)
  18 lines  src/lib/store.mjs           (claude-opus-4.6)

Total: 60 AI-attributed lines
```

### `gitai log`

Git log enriched with AI involvement per commit.

```
$ gitai log
7aaf4c2 Add stats and log commands  [AI: 60 lines - claude-opus-4.6]
149881e Add blame command            [AI: 42 lines - claude-opus-4.6]
05af0d4 Add post-commit hook
767a715 Add extension                [AI: 134 lines - claude-opus-4.6]
```

Options: `-n, --limit <number>` - number of commits to show (default: 30)

### `gitai install`

Sets up tracking in the current git repository:

1. Installs a `post-commit` hook in `.git/hooks/`
2. Symlinks the Copilot CLI extension to `~/.copilot/extensions/ai-blame/`
3. Adds `.git/ai-blame/` to `.gitignore` if not already present

After installing, restart your Copilot CLI session (`/clear` or new terminal) to load the extension.

## How it works

```
Copilot CLI session
  |
  v
Extension (hooks into edit/create tool calls)
  |-- onPreToolUse:  snapshot file content + current model
  |-- onPostToolUse: LCS diff -> write changed lines to pending.jsonl
  |
  v
git commit
  |
  v
post-commit hook: move pending.jsonl -> commits/<sha>.jsonl
  |
  v
gitai blame/stats/log: read commits/*.jsonl, overlay on git data
```

### Data format

Records are stored as JSONL in `.git/ai-blame/commits/<sha>.jsonl`:

```json
{"file":"src/main.kt","lines":[[1,15],[20,25]],"model":"claude-opus-4.6","timestamp":"2026-04-25T20:00:00.000Z"}
```

Data lives in `.git/ai-blame/` and is not tracked by git (local to your clone).

## Limitations

- Attribution data does not survive `git rebase`, `cherry-pick`, or `amend` (line numbers shift)
- Only tracks edits made through Copilot CLI - direct editor changes are not captured
- Data is local - not pushed to remotes (future: git notes integration)

## License

MIT
