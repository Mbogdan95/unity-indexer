# Remove npm Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all npm package distribution from README, CI/CD, and package.json — unity-indexer is now plugin-only.

**Architecture:** Three surgical file edits. No new files. No tests (config/doc changes). Verification is manual diff inspection + CI pass.

**Tech Stack:** Markdown, YAML, JSON

**Spec:** `docs/specs/2026-06-24-remove-npm-distribution.md`

---

## File Map

| Action | Path                            | Change                                                                 |
| ------ | ------------------------------- | ---------------------------------------------------------------------- |
| Modify | `README.md`                     | Remove npm badge, Quick Start npm block, npm/Manual install subsection |
| Modify | `.github/workflows/publish.yml` | Remove registry-url, npm publish step, NODE_AUTH_TOKEN                 |
| Modify | `package.json`                  | Remove prepublishOnly script                                           |

---

## Task 1: Update README.md

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Remove the npm version badge**

Find this line near the top of `README.md`:

```markdown
[![npm version](https://img.shields.io/npm/v/unity-indexer)](https://www.npmjs.com/package/unity-indexer)
```

Delete it entirely. The remaining badges (`license`, `node`, `TypeScript`) stay.

- [ ] **Step 2: Update Quick Start — remove npm block**

Find this block in the Quick Start section:

````markdown
**npm — manual setup:**

```bash
npx unity-indexer install            # register in Claude Code settings
npx unity-indexer <path-to-project>  # start the server
```
````

````

Delete it entirely (the heading line + the code block). The Claude Code plugin block stays unchanged.

- [ ] **Step 3: Remove the npm/Manual installation subsection**

Find and delete this entire subsection from the Installation section:

```markdown
### npm / Manual

```bash
# Option A: without global install
npx unity-indexer install          # registers in ~/.claude/settings.json
npx unity-indexer <project-path>   # start the server

# Option B: global install
npm install -g unity-indexer
unity-indexer install
unity-indexer <project-path>
````

`install` writes to Claude Code settings. Use `--scope` to select the settings file:

| Scope              | File                            |
| ------------------ | ------------------------------- |
| `global` (default) | `~/.claude/settings.json`       |
| `local`            | `~/.claude/settings.local.json` |
| `project`          | `.claude/settings.json`         |
| `project-local`    | `.claude/settings.local.json`   |

```bash
unity-indexer install --scope project
```

````

The "### Claude Code Plugin" subsection and everything after it stays.

- [ ] **Step 4: Verify README looks correct**

```bash
grep -n "npm" README.md
````

Expected: only references inside the "Starting the server" section (`npx unity-indexer <path>`) and Development section. No npm install instructions, no npm badge.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: remove npm distribution from README"
```

---

## Task 2: Update publish.yml

**Files:**

- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Remove registry-url from setup-node step**

Find this block:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version: 22
    registry-url: https://registry.npmjs.org
    cache: npm
```

Replace with:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version: 22
    cache: npm
```

- [ ] **Step 2: Remove the npm publish step**

Find and delete this entire step:

```yaml
- name: Publish to npm
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Verify publish.yml looks correct**

```bash
grep -n "npm\|NODE_AUTH\|registry" .github/workflows/publish.yml
```

Expected: only `npm install`, `npm run *`, `npm ci`, `npm version` references remain. No `npm publish`, no `NODE_AUTH_TOKEN`, no `registry-url`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: remove npm publish from release workflow"
```

---

## Task 3: Update package.json

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Remove prepublishOnly script**

Find in the `"scripts"` section:

```json
"prepublishOnly": "npm run typecheck && npm run lint && npm run test && npm run build",
```

Delete that line entirely.

- [ ] **Step 2: Verify package.json is valid JSON and script is gone**

```bash
node -e "const p = require('./package.json'); console.log('valid JSON'); console.log('prepublishOnly' in p.scripts ? 'FAIL: still present' : 'OK: removed')"
```

Expected:

```
valid JSON
OK: removed
```

- [ ] **Step 3: Run CI locally to confirm nothing broken**

```bash
npm run ci
```

Expected: all checks pass (typecheck, lint, format, test, build).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: remove prepublishOnly script"
```
