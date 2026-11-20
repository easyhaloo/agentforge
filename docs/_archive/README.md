# agent.md Deletion Notice

**Date**: 2024-11-20

## Why agent.md was deleted

The original `agent.md` (418 lines) mixed multiple concerns:
- AI development standards (universal)
- Claude Code configuration (tool-specific)
- Frontend development guide (React/TypeScript)
- Product domain rules

This created maintenance burden and made it hard for:
- Non-Claude AI tools to find relevant guidance
- Developers to locate frontend vs backend standards
- Documentation to scale as the project grows

## New Documentation Structure

`agent.md` content has been split into:

| Old Location | New Location | Purpose |
|--------------|--------------|---------|
| `agent.md` sections 1-2, 6-7 | `AGENTS.md` | Universal AI standards, product context, domain rules |
| `agent.md` Git/tool config | `CLAUDE.md` | Claude Code-specific configuration |
| `agent.md` sections 3-5, 8-11 | `docs/development/frontend.md` | React/TypeScript development guide |
| Backend (was missing) | `docs/development/backend.md` | Go development guide |

## Migration Guide

### For AI Agents
**Old**: Read `agent.md` first
**New**: Read `AGENTS.md` first, then:
- `docs/development/frontend.md` for React/TypeScript work
- `docs/development/backend.md` for Go work
- `CLAUDE.md` if using Claude Code

### For Documentation Updates
**Old**: Update `agent.md` for any development standard
**New**: Update the appropriate specialized file:
- Universal AI rules → `AGENTS.md`
- Frontend standards → `docs/development/frontend.md`
- Backend standards → `docs/development/backend.md`
- Claude Code config → `CLAUDE.md`
- Architecture decisions → `docs/architecture/`

## Benefits of New Structure

1. **Separation of Concerns**: Each file has single, clear purpose
2. **Tool Agnostic**: AGENTS.md works for all AI tools (Cursor, Copilot, Continue, etc.)
3. **Scalability**: Frontend and backend guides can grow independently
4. **Maintainability**: Changes to React standards don't affect Go standards
5. **Discoverability**: Developers know where to find frontend vs backend rules

## Content Migration

All content from `agent.md` has been migrated to the new structure with improvements:
- Added backend development guide (was missing)
- Added documentation placement rules
- Clarified domain invariants
- Enhanced commit message format specification
