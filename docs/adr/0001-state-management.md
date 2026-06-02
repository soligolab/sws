# ADR 0001 — State Management Library for sws-editor

**Status**: Accepted  
**Date**: 2026-05-10  
**Decided**: 2026-06-02  
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

**Accepted: Option A — Zustand.**

After T-01…T-21 (full PoC implementation), Zustand has proven adequate for the store
surface: tags, alarms, auth, canvas selection, undo/redo history, project state, and
WebSocket live data. The store grew to ~600 lines but remained readable and maintainable.

No migration to RTK is planned for the PoC phase. Revisit if multi-user CRDT editing
is introduced in the product phase (M5+).

## Consequences

- Zustand remains the state management library for `sws-editor`
- `src/store/index.ts` is the single Zustand store; all components use `useAppStore`
- If the store grows beyond ~1000 lines, consider splitting into slices (Zustand supports
  this natively) before considering a full migration to RTK
