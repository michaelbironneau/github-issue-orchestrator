---
name: triage
description: Planner → Reviewer chain for spec approval before implementation begins.
---

# Triage Chain

Runs a planner to elaborate an issue, then a reviewer to validate the plan before implementation begins.

## Usage

```
/run triage "Plan #<N>: <title>\n<body>"
```

## Chain

1. **planner** — decomposes the issue into an implementation plan and updates the issue body.
2. **reviewer** — reads the plan posted by the planner and verifies it is complete, unambiguous, and safe to implement. Posts APPROVE or REVISE verdict on the issue.

If the reviewer posts REVISE, address the feedback and re-run this chain before dispatching workers.
