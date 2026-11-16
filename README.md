# AgentForge

**Agent-native Source Control & Verified Change Platform** — responsive interactive frontend prototype.

## Stack
- React 19 + TypeScript + Vite
- Lucide React
- Revision-scoped delivery invariants
- Browser-local persistence for demo workflows and resource creation

## Run locally
```bash
npm install
npm run dev
```

## Validate
```bash
npm test
npm run build
npm run preview
```

## Product areas
Overview, Projects, Repositories, Changesets, Workspaces, Trails, Stacks, Review, Eval, Self-healing, Memory, CI/CD, Security, Governance, Cost & Usage, Settings.

## Frontend interactions
- Navigate all 16 product areas from the sidebar or command palette (⌘K / Ctrl+K).
- Create and inspect local resources; search and filter resource lists.
- Run the Changeset → Eval → Review → Trail workflow with revision-scoped evidence.
- Create revisions, restack a demo stack, simulate self-healing and inspect the audit timeline.
- Persist demo changes in browser local storage across reloads.
- Responsive desktop, tablet and mobile layouts.

## Domain rules
- Changeset IDs are stable; revision IDs identify an individual changeset revision.
- Git commit SHAs, changeset IDs and revision IDs are separate concepts.
- Evaluation evidence and review decisions are bound to a specific revision.
- A new revision makes earlier evidence and approvals stale.
- Merge requires passing evidence and approval for the exact current revision.

## Explicit limitations
This is a frontend-only prototype using seeded mock data and browser local storage. It does not perform real Git operations, create remote branches or commits, execute agent sessions, run remote CI, send review notifications, enforce organization security policies, or persist data to a backend. Demo actions are local simulations only.
