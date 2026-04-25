# github-orchestrator

A [Pi coding agent](https://github.com/badlogic/pi-mono) extension that turns GitHub Projects into a fully automated, parallel issue-to-PR pipeline.

GitHub Projects is the source of truth — no separate dashboard. Agents work on isolated git worktrees, open PRs, post review verdicts, and move issues through columns automatically. All agent behaviour is defined in plain markdown files you can edit freely.

## How it works

```
Backlog (needs-planning)
  └─ /plan-all  ──▶  ghplanner agents elaborate each issue in parallel
                      ↓ posts implementation plan, removes label, moves to "Ready"
  Human reviews plans in "Ready" column
  └─ /dispatch  ──▶  ghworker agents implement each issue in parallel worktrees
                      ↓ opens PR, moves issue to "In Review"
                     ghreviewer agent inspects diff, posts APPROVE ✅ or REVISE 🔄
                      ↓ on APPROVE
                     human reviews and merges PR if they wish
```

The extension itself is ~400 lines of TypeScript and owns only the GitHub API layer. Orchestration, parallelism, and agent logic live in pi-subagents and the agent prompt templates bundled with the extension.

## Requirements

- [Pi coding agent](https://github.com/badlogic/pi-mono) installed
- [Pi subagents](https://github.com/nicobailon/pi-subagents) installed
- A GitHub Personal Access Token with `repo` and `project` scopes, either:
  - Set as `GITHUB_TOKEN` environment variable, or
  - Available via `gh auth token` (GitHub CLI)
- A GitHub Project (Projects v2) with a `Status` single-select field

## Installation

Install into your project (recommended — shares config with your team via `.pi/settings.json`):

```bash
pi install -l git:github.com/michaelbironneau/github-orchestrator
```

Or install globally (available in all projects):

```bash
pi install git:github.com/michaelbironneau/github-orchestrator
```

`pi install` handles `npm install` automatically. On first session start the extension copies its agent templates into `.pi/agents/` (project install) or `~/.pi/agent/agents/` (global install). Running `pi update` followed by a session restart keeps the agents in sync with the latest version.

## Configuration

Create `.pi/settings.json` in your project:

```json
{
  "githubOrchestrator": {
    "owner": "org or personal account",
    "repo": "my-repo",
    "projectNumber": 1,
    "backlogColumn": "Backlog",
    "readyColumn": "Ready",
    "inProgressColumn": "In Progress",
    "inReviewColumn": "In Review",
    "doneColumn": "Done",
    "baseBranch": "main",
    "maxParallel": 3
  }
}
```

Only `owner`, `repo`, and `projectNumber` are required. All other fields default to the values shown above. The `readyColumn` is where the planner deposits issues for human review before dispatch — make sure this column exists in your GitHub Project.

## Commands

| Command | Description |
|---------|-------------|
| `/plan-all` | Fetch all Backlog issues labelled `needs-planning` (skipping those labelled `human`) and fan out ghplanner agents in parallel |
| `/plan <N> [instructions]` | Plan a single issue by number, with optional extra instructions |
| `/dispatch` | Fetch all Ready-column issues (skipping those labelled `human`) and fan out ghworker agents in parallel |

You can also run the predefined chains directly:

| Chain | Description |
|-------|-------------|
| `/run ghtriage "Plan #N: ..."` | ghplanner → ghreviewer (validates the plan before implementation) |
| `/run ghimplement "implement #N: ..."` | ghworker → ghreviewer (implements and code-reviews in one pass) |
| `/run ghfull "Plan #N: ..."` | Full pipeline: ghtriage + ghimplement combined |

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

## Human-reserved issues

Issues labelled `human` are excluded from all automated commands (`/plan-all`, `/plan`, and `/dispatch`). This allows humans to reserve specific issues for manual planning or implementation without agent interference.

## Agent behaviour

Agent prompts are bundled with the extension and deployed automatically on session start:

| Agent | Role |
|-------|------|
| `ghworker` | Implements an issue end-to-end and opens a PR |
| `ghplanner` | Writes an implementation plan without touching code |
| `ghreviewer` | Reviews a PR diff or plan and posts a verdict |
| `ghtriage` | ghplanner → ghreviewer chain |
| `ghimplement` | ghworker → ghreviewer chain |
| `ghfull` | Complete ghtriage + ghimplement pipeline |

The agents are force-overwritten on every session start to stay in sync with the installed version. Do not edit the deployed copies in `.pi/agents/` — they will be overwritten. To customise behaviour, fork this repository and point your `pi install` at your fork.

## Development

Type-check the extension:

```bash
cd .pi/extensions/github-orchestrator
npx tsc --noEmit
```

Pi loads `.ts` files directly at runtime; there is no build step.
