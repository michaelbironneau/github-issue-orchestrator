---
name: full
description: Full pipeline: triage (plan + spec review) followed by implement (worker + code review).
---

# Full Chain

Runs the complete pipeline from rough issue to reviewed PR.

## Usage

```
/run full "Plan #<N>: <title>\n<body>"
```

## Chain

1. **planner** — elaborates the issue into a detailed implementation plan.
2. **reviewer** — validates the plan (spec approval). Stops here with REVISE if the plan needs work.
3. **worker** — implements the issue on a feature branch and opens a PR.
4. **reviewer** — reviews the PR diff and posts APPROVE or REVISE verdict.

Only use this chain for issues that are clearly scoped. For exploratory or ambiguous issues, run `/plan` manually first.
