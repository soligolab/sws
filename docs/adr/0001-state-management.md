# ADR 0001 — State Management Library for sws-editor

**Status**: Proposed  
**Date**: 2026-05-10  
**Deciders**: Soligo Lab maintainers

## Context

`sws-editor` requires client-side state for:

- Currently open project and selected synoptic page
- Selected canvas object (editor mode)
- Live tag values streamed from the runtime (operator view)
- User session and permissions

The state surface is moderate in size but involves real-time updates (tag stream) and
cross-component communication (canvas ↔ properties panel ↔ alarm banner).

## Options

### Option A — Zustand

- Minimal boilerplate; store defined as plain functions
- Fine-grained subscriptions without selectors boilerplate
- Small bundle (~3 kB gzipped)
- Less opinionated — easier to iterate on in early development

### Option B — Redux Toolkit (RTK)

- Battle-tested at scale; excellent devtools
- Enforces immutability and action-based patterns
- Larger bundle and more boilerplate for simple slices
- Better fit if the store grows complex (undo/redo, time-travel)

## Decision

**Pending** — provisional implementation uses Zustand (Option A) because of lower startup
cost. This decision must be reviewed before Milestone 1 (M1) freeze. If undo/redo or
multi-user CRDT merge (planned for M5) requires Redux middleware, migrate then.

## Consequences

- Zustand is installed as a dependency in `package.json`
- `src/store/index.ts` exports a Zustand store; refactoring to RTK would touch all
  `useStore` call sites
- ADR must be updated with final decision before PR #3 is merged
