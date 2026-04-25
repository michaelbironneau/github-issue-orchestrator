---
name: ghimplement
description: ghworker → ghreviewer chain for automated code review after implementation.
---

# Implement Chain

Runs a ghworker to implement an issue, then a ghreviewer to validate the result.

## Usage

```
/run ghimplement "implement #<N>: <title>\n<body>"
```

## Chain

1. **ghworker** — implements the issue on a feature branch, opens a PR, moves issue to In Review.
2. **ghreviewer** — reviews the PR diff against the issue, posts APPROVE or REVISE verdict.
