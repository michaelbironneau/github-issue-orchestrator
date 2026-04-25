---
name: ghfull
description: Full pipeline: ghtriage (plan + spec review) followed by ghimplement (worker + code review).
---

# Full Chain

Runs the complete pipeline from rough issue to reviewed PR.

## Usage

```
/run ghfull "Plan #<N>: <title>\n<body>"
```

## Chain

1. **ghplanner** — elaborates the issue into a detailed implementation plan.
2. **ghworker** — implements the issue on a feature branch and opens a PR.
3. **ghreviewer** — reviews the PR diff and posts APPROVE or REVISE verdict.

Only use this chain for issues that are clearly scoped. For exploratory or ambiguous issues, run `/plan` manually first.
