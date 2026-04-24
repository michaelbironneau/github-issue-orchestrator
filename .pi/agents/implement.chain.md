---
name: implement
description: Worker → Reviewer chain for automated code review after implementation.
---

# Implement Chain

Runs a worker to implement an issue, then a reviewer to validate the result.

## Usage

```
/run implement "implement #<N>: <title>\n<body>"
```

## Chain

1. **worker** — implements the issue on a feature branch, opens a PR, moves issue to In Review.
2. **reviewer** — reviews the PR diff against the issue, posts APPROVE or REVISE verdict.

On APPROVE the issue is moved to Done. On REVISE the worker should address the feedback.
