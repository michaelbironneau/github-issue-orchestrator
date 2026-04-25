# github-orchestrator

A [Pi coding agent](https://github.com/badlogic/pi-mono) extension that turns GitHub Projects into a fully automated, parallel issue-to-PR pipeline.

GitHub Projects is the source of truth — no separate dashboard. Agents work on isolated git worktrees, open PRs, post review verdicts, and move issues through columns automatically. All agent behaviour is defined in plain markdown files you can edit freely.

## How it works

```
Backlog (needs-planning)
  └─ /plan-all  ──▶  planner agents elaborate each issue in parallel
                      ↓ posts implementation plan as comment, removes label
  Human reviews plans, moves issues to "To Do"
  └─ /dispatch  ──▶  worker agents implement each issue in parallel worktrees
                      ↓ opens PR, moves issue to "In Review"
                     reviewer agent inspects diff, posts APPROVE ✅ or REVISE 🔄
                      ↓ on APPROVE
                     human reviews and merges PR if they wish
```

The extension itself is ~400 lines of TypeScript and owns only the GitHub API layer. Orchestration, parallelism, and agent logic live in pi-subagents and the `.pi/agents/*.md` prompt templates.

## Requirements

- [Pi coding agent](https://github.com/badlogic/pi-mono) installed
- A GitHub Personal Access Token with `repo` and `project` scopes, either:
  - Set as `GITHUB_TOKEN` environment variable, or
  - Available via `gh auth token` (GitHub CLI)
- A GitHub Project (Projects v2) with a `Status` single-select field

## Installation

Copy this repository's `.pi/` directory into your project root:

```bash
cp -r .pi/ /your/project/
```

Then install the extension dependencies:

```bash
cd .pi/extensions/github-orchestrator
npm install
```

## Configuration

Edit `.pi/settings.json` in your project:

```json
{
  "githubOrchestrator": {
    "owner": "my-org",
    "repo": "my-repo",
    "projectNumber": 1,
    "backlogColumn": "Backlog",
    "todoColumn": "To Do",
    "inProgressColumn": "In Progress",
    "inReviewColumn": "In Review",
    "doneColumn": "Done",
    "baseBranch": "main",
    "maxParallel": 3
  }
}
```

Only `owner`, `repo`, and `projectNumber` are required. All other fields default to the values shown above.

## Commands

| Command | Description |
|---------|-------------|
| `/plan-all` | Fetch all Backlog issues labelled `needs-planning` and fan out planner agents in parallel |
| `/plan <N> [instructions]` | Plan a single issue by number, with optional extra instructions |
| `/dispatch` | Fetch all "To Do" issues and fan out worker agents in parallel |

You can also run the predefined chains directly:

| Chain | Description |
|-------|-------------|
| `/run triage "Plan #N: ..."` | planner → reviewer (validates the plan before implementation) |
| `/run implement "implement #N: ..."` | worker → reviewer (implements and code-reviews in one pass) |
| `/run full "Plan #N: ..."` | Full pipeline: triage + implement combined |

## Tools available to agents

The extension registers these tools that agents (and the LLM) can call:

| Tool | Description |
|------|-------------|
| `gh_list_issues` | Fetch the project board grouped by column |
| `gh_move_issue` | Move an issue to a different column |
| `gh_remove_label` | Remove a label from an issue |
| `gh_create_pr` | Open a PR on the current branch (adds `Closes #N` automatically) |
| `gh_add_comment` | Post a markdown comment on an issue |

Direct pushes to the base branch and force pushes are blocked — agents must use `gh_create_pr`.

## Customising agent behaviour

All agent prompts live in `.pi/agents/` as plain markdown files:

| File | Role |
|------|------|
| `worker.md` | Implements an issue end-to-end and opens a PR |
| `planner.md` | Writes an implementation plan without touching code |
| `reviewer.md` | Reviews a PR diff or plan and posts a verdict |
| `triage.chain.md` | planner → reviewer chain |
| `implement.chain.md` | worker → reviewer chain |
| `full.chain.md` | Complete triage + implement pipeline |

Edit any of these files and run `/reload` — no other configuration needed.

## Development

Type-check the extension:

```bash
cd .pi/extensions/github-orchestrator
npx tsc --noEmit
```

Pi loads `.ts` files directly at runtime; there is no build step.
