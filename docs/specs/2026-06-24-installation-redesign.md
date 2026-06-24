# Installation Redesign — unity-indexer

**Date:** 2026-06-24
**Scope:** Claude Code + Cursor plugin installation, session-start hook, SKILL.md rewrite

---

## Problem

Current installation has three gaps:

1. No `SessionStart` hook — `skills/unity-indexer/SKILL.md` exists but is never auto-injected. Claude must be told about the tools manually.
2. No Cursor support — no `.cursor-plugin/` manifest, no MCP auto-registration for Cursor.
3. SKILL.md is incomplete — contains workflows only; the tool reference table lives separately in CLAUDE.md and is not injected.

---

## Goal

Mirror the Superpowers plugin pattern (github.com/obra/Superpowers, 237k stars):

- Single install command for each harness, zero config after
- Session-start hook auto-injects comprehensive skill context every session
- Both Claude Code and Cursor get MCP server auto-registered + skill injected on install

---

## New Files

```
unity-indexer/
├── .claude-plugin/
│   ├── plugin.json          ← UPDATE: add hooks reference
│   └── marketplace.json     ← unchanged
├── .cursor-plugin/          ← NEW
│   └── plugin.json          ← skills + hooks + mcpServers
├── hooks/                   ← NEW
│   ├── session-start        ← bash script: reads SKILL.md, emits harness JSON
│   ├── hooks.json           ← Claude Code SessionStart registration
│   └── hooks-cursor.json    ← Cursor sessionStart registration
├── mcp.json                 ← NEW: Cursor MCP server declaration
├── skills/unity-indexer/
│   └── SKILL.md             ← REWRITE: comprehensive auto-injected guide
└── package.json             ← UPDATE: add skills/, hooks/, mcp.json to "files"
```

---

## Install UX After Change

| Harness        | Command                                       | Result                                   |
| -------------- | --------------------------------------------- | ---------------------------------------- |
| Claude Code    | `/plugin install unity-indexer@unity-indexer` | MCP registered + hook fires each session |
| Cursor         | `/add-plugin unity-indexer`                   | MCP registered + hook fires each session |
| npm (existing) | `npx unity-indexer install`                   | MCP registered (unchanged)               |

---

## Section 1: Hooks System

### `hooks/session-start`

Bash script. Detects harness via environment variable, reads `SKILL.md`, emits harness-appropriate JSON.

- `$CLAUDE_PLUGIN_ROOT` set → Claude Code → emit `hookSpecificOutput` format
- `$CURSOR_PLUGIN_ROOT` set → Cursor → emit `additional_context` format
- Neither set → `exit 0` (no-op, e.g. npm manual usage)

Uses `python3` for JSON-safe string escaping (matches Superpowers approach). `python3` is guaranteed present on macOS; on Linux, falls back to `node -e` if absent (both Claude Code and Cursor require Node.js anyway).

### `hooks/hooks.json` (Claude Code)

Registers `SessionStart` hook with matcher `startup|clear|compact`. Async: false (injection must complete before session context is built).

### `hooks/hooks-cursor.json` (Cursor)

Registers `sessionStart` hook, version 1 format.

---

## Section 2: Plugin Manifests

### `.claude-plugin/plugin.json`

Add `"hooks": "./hooks/hooks.json"` to existing manifest. No other changes — MCP auto-registration already works via current plugin system.

### `.cursor-plugin/plugin.json` (new)

Fields:

- `skills`: `"./skills/"` — Cursor loads skill files from this directory
- `hooks`: `"./hooks/hooks-cursor.json"` — session-start hook registration
- `mcpServers`: `"./mcp.json"` — path to MCP server declaration (Cursor auto-detects on install)

### `mcp.json` (new, at repo root)

Standard Cursor MCP config format. Declares `unity-indexer` server: `command: npx`, `args: ["unity-indexer"]`. Matches Cursor's `~/.cursor/mcp.json` schema.

---

## Section 3: SKILL.md Rewrite

Replace current workflow-only SKILL.md with a comprehensive auto-injected guide. Structure:

1. **Trigger** — when to use MCP tools vs reading files directly
2. **Server startup** — `npx unity-indexer <path>` if tools unavailable
3. **Tool reference** — all 23 tools in 5 category tables (currently lives only in CLAUDE.md)
4. **Workflows** — 6 condensed workflows from current SKILL.md
5. **Tips** — multi-project usage, `file_path`+line with `Read`, `batch_get_script_detail`

Written for injection context: direct, imperative, no prose padding. CLAUDE.md is not replaced — it remains as project-level documentation. The injected skill gives Claude full context in any project, even without CLAUDE.md.

---

## Section 4: Package Distribution

`package.json` `"files"` updated from `["dist/"]` to `["dist/", "skills/", "hooks/", "mcp.json"]`.

Skills and hooks must ship with the npm package so the plugin install has access to them at `$CLAUDE_PLUGIN_ROOT` and `$CURSOR_PLUGIN_ROOT`.

---

## Session Start Flow

```
Session opens (Claude Code or Cursor)
  → Hook fires: hooks/session-start
  → Script reads skills/unity-indexer/SKILL.md
  → Detects harness via env var
  → Emits JSON with skill content
  → Harness injects as <EXTREMELY_IMPORTANT> context
  → Claude has full tool reference + workflows without any user action
```

---

## What Does NOT Change

- `npx unity-indexer install` CLI flow — unchanged
- `unity-indexer <path>` server start — unchanged
- CLAUDE.md — unchanged (project-level docs, separate from injected skill)
- `.claude-plugin/marketplace.json` — unchanged
- All 23 MCP tool implementations — unchanged

---

## Out of Scope

- Windows support for `hooks/session-start` (bash script; Claude Code and Cursor are macOS/Linux primary)
- Superpowers official marketplace listing (separate process)
- Other harnesses (Copilot CLI, Gemini CLI, etc.) — follow-up
