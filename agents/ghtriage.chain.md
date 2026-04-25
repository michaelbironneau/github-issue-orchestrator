---
name: ghtriage
description: ghplanner → ghreviewer chain for spec approval before implementation begins.
---

# Triage Chain

Runs a ghplanner to elaborate an issue, then a ghreviewer to validate the plan before implementation begins.

## Usage

```
/run ghtriage "Plan #<N>: <title>\n<body>"
```

## Chain

1. **ghplanner** — decomposes the issue into an implementation plan and updates the issue body.
2. **ghreviewer** — reads the plan posted by the ghplanner and verifies it is complete, unambiguous, and safe to implement. Posts APPROVE or REVISE verdict on the issue.

If the ghreviewer posts REVISE, address the feedback and re-run this chain before dispatching workers.
