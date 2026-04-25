# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A [Pi coding agent](https://github.com/badlogic/pi-mono) extension that uses GitHub Projects as the source of truth for issue management, with a PR-based git workflow and parallel agent execution via pi-subagents.

The extension lives in `.pi/extensions/github-orchestrator/src/index.ts` (~400 lines) and is intentionally thin — it only owns the GitHub API layer. All orchestration is delegated to pi-subagents and `.pi/agents/*.md` prompt templates.

## Build & type-check

```bash
cd .pi/extensions/github-orchestrator
npm install           # install deps (octokit/rest, octokit/graphql)
npx tsc --noEmit      # type-check only (noEmit is set in tsconfig)
```

There is no compiled output — Pi loads `.ts` files directly at runtime.

## Architecture

### Extension (`src/index.ts`)

The default export is an async function receiving `ExtensionAPI` from `@mariozechner/pi-coding-agent`. Initialization (config load + GitHub auth) is deferred to first use via a lazy `init()` call so the extension doesn't break when `.pi/settings.json` is absent at load time.

**Tools registered** (callable by the LLM):
| Tool | Purpose |
|------|---------|
| `gh_list_issues` | Fetch the full project board grouped by column |
| `gh_move_issue` | Move an issue to a different Status column |
| `gh_remove_label` | Remove a label from an issue |
| `gh_create_pr` | Open a PR on the current branch, auto-adding `Closes #N` |
| `gh_update_issue` | Update an issue's title and/or body (overwrites previous values) |
| `gh_add_comment` | Post a markdown comment on an issue |

**Hook**: `tool_call` intercept blocks any `git push` to the base branch or any force push, redirecting agents to use `gh_create_pr` instead.

**Commands** (user-invocable via `/`):
| Command | Behaviour |
|---------|-----------|
| `/plan-all` | Fans out `planner[worktree=true]` agents for all Backlog issues labelled `needs-planning`, up to `maxParallel` |
| `/plan <N> [instructions]` | Runs a single planner for issue `#N` |
| `/dispatch` | Fans out `worker[worktree=true]` agents for all issues in the `todoColumn`, up to `maxParallel` |

`/plan-all` and `/dispatch` emit a `/parallel ...` pi command via `pi.sendUserMessage(..., { deliverAs: "followUp" })`.

### GitHub API layer

- REST calls use `@octokit/rest` (issue comments, labels, PRs).
- Project board queries and mutations use `@octokit/graphql` (GraphQL API v2 for project column/status).
- Project metadata (node IDs, field IDs, column option IDs) is fetched once and cached in `projectMetaCache`.
- **Organization and personal accounts**: GraphQL queries try `organization(login: $owner)` first; if the project is not found under that scope (e.g. the owner is a personal account), the query falls back to `user(login: $owner)`. No configuration change is needed — the same `owner` setting works for both.
- Auth: `GITHUB_TOKEN` env var, falling back to `gh auth token`.

### Agent prompt templates (`.pi/agents/`)

All agents use `worktree: true` and `inheritProjectContext: true`.

| File | Role |
|------|------|
| `worker.md` | Implements an issue, opens a PR via `gh_create_pr`, moves to In Review, posts summary comment |
| `planner.md` | Writes an implementation plan, overwrites the issue body with the plan, removes `needs-planning` label — no code changes |
| `reviewer.md` | Reviews PR diff or plan, posts APPROVE ✅ or REVISE 🔄 verdict |
| `triage.chain.md` | planner → reviewer (spec approval before implementation) |
| `implement.chain.md` | worker → reviewer (code review after implementation) |
| `full.chain.md` | Full pipeline: triage + implement combined |

Users can edit these `.md` files freely; changes take effect on the next `/reload`.

### Configuration (`.pi/settings.json`)

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

Only `owner`, `repo`, and `projectNumber` are required; all other fields have defaults matching the above.

## Typical workflow

```
Backlog (needs-planning label)
  → /plan-all  → planner agents elaborate issues → issues ready for human review
  → human moves issues to "To Do"
  → /dispatch  → worker agents implement in parallel worktrees → PRs opened
  → reviewer agents post APPROVE/REVISE → issues move to Done
```

## Extension API reference

Full Pi extension docs are in `extensions.md` (local copy) and at https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs. Key patterns:

- `pi.registerTool({ name, label, description, parameters, execute })` — `parameters` uses `typebox` `Type.*` schemas.
- `pi.registerCommand(name, { description, handler })` — handler receives `(args: string, ctx)`.
- `pi.on("tool_call", handler)` — return `{ block: true, reason }` to block; return nothing to allow.
- `pi.exec(cmd, args)` — run a process, returns `{ code, stdout, stderr }`.
- `pi.sendUserMessage(text, { deliverAs: "followUp" })` — inject a message as if the user typed it.
