# Remove npm Distribution — unity-indexer

**Date:** 2026-06-24
**Scope:** README.md, publish.yml, package.json

---

## Goal

Remove npm package distribution from all user-facing docs and CI/CD. unity-indexer is now distributed exclusively as a Claude Code plugin (and Cursor plugin) via GitHub. npm publish is no longer needed.

---

## Changes

### README.md

- Remove `[![npm version]...]` badge from header
- Quick Start: remove "npm — manual setup" block, keep only the plugin install block
- Installation section: remove entire "### npm / Manual" subsection (options A and B, scope table, `--scope` example)
- "Starting the server" section: unchanged — users still start the server after plugin install
- All other sections unchanged

### `.github/workflows/publish.yml`

- Remove `registry-url: https://registry.npmjs.org` from the setup-node step
- Remove the "Publish to npm" step (`npm publish` + `NODE_AUTH_TOKEN`)
- Keep: version bump, typecheck, lint, test, build, changelog generation, git tag, GitHub release creation

### `package.json`

- Remove `prepublishOnly` script (only relevant for npm publish lifecycle)
- Keep: `bin`, `files`, `scripts`, all other metadata

---

## What Does NOT Change

- CI workflow (`ci.yml`) — unchanged
- `security.yml` — unchanged
- npm metadata in `package.json` (name, version, keywords, description) — unchanged
- `"files"` field — unchanged
- `bin` entry — unchanged (still needed to run the MCP server via npx)
- Server start instructions in README — unchanged
