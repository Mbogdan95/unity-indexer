# Project Tooling & Code Quality Design

**Date:** 2026-06-04
**Scope:** Add linting, formatting, type checking, security scanning, CI/CD, pre-commit hooks, and npm package configuration to unity-indexer.
**Approach:** All-at-once (Approach A) — project is ~4K LOC, all configs are independent.

---

## 1. ESLint (Flat Config)

**File:** `eslint.config.js`

**Dependencies:**
- `@eslint/js`
- `typescript-eslint` (v8+)
- `eslint-config-prettier`

**Configuration:**
- Base: `@eslint/js` recommended + `typescript-eslint` strict-type-checked
- Key rules enabled: `no-explicit-any`, `strict-boolean-expressions`, `no-floating-promises`, `consistent-type-imports`
- Prettier integration: `eslint-config-prettier` disables conflicting formatting rules (no `eslint-plugin-prettier`)
- Ignores: `dist/`, `node_modules/`, root `*.js` config files
- Test file overrides: relaxed rules (allow `any` in mocks, relax strict-boolean-expressions)

**Scripts:**
- `npm run lint` — `eslint .`
- `npm run lint:fix` — `eslint . --fix`

## 2. Prettier

**Files:** `.prettierrc`, `.prettierignore`

**Dependencies:**
- `prettier`

**Configuration (.prettierrc):**
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

**Ignore (.prettierignore):**
- `dist/`
- `node_modules/`
- `*.db`
- `package-lock.json`
- `grammars/`

**Scripts:**
- `npm run format` — `prettier --write .`
- `npm run format:check` — `prettier --check .`

## 3. Pre-commit Hooks (Husky + lint-staged)

**Dependencies:**
- `husky`
- `lint-staged`

**Hook: pre-commit** — runs `lint-staged`:
- `*.ts` → `eslint --fix` then `prettier --write`
- `*.json`, `*.md`, `*.yml` → `prettier --write`

**Hook: pre-push** — runs `tsc --noEmit` (full type check before push).

**package.json lint-staged config:**
```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

**Husky setup:**
- `prepare` script: `husky` (auto-installs hooks on `npm install`)

## 4. Type Checking

No changes to existing `tsconfig.json` — `strict: true` already configured.

**New script:**
- `npm run typecheck` — `tsc --noEmit`

CI runs typecheck as a separate step for clear error attribution.

## 5. GitHub Actions CI

### Main CI Workflow (`.github/workflows/ci.yml`)

**Triggers:** push to `main`, all PRs

**Matrix:** Node 18, 20, 22

**Steps:**
1. Checkout
2. Setup Node (matrix version)
3. `npm ci`
4. `npm run typecheck`
5. `npm run lint`
6. `npm run format:check`
7. `npm run test`
8. `npm run build`

Fail-fast enabled — any step failure blocks merge.

### Security Workflow (`.github/workflows/security.yml`)

**Triggers:** push to `main`, PRs, weekly schedule (Sunday midnight)

**Steps:**
1. `npm audit --audit-level=high`
2. CodeQL analysis (JavaScript/TypeScript) — uses `github/codeql-action`

## 6. Security Scanning

### Dependabot (`.github/dependabot.yml`)

- Ecosystem: npm — weekly checks, auto-opens PRs for vulnerable or outdated deps
- Ecosystem: github-actions — weekly checks for action version updates

### CodeQL

Integrated in security workflow (Section 5). Scans for:
- SQL injection (relevant — project uses better-sqlite3)
- Path traversal (relevant — project resolves file paths from CLI args)
- General JavaScript/TypeScript vulnerabilities

### Socket.dev

External GitHub App — install separately from GitHub Marketplace. Free for open source. Analyzes new/updated dependencies in PRs for supply chain attack indicators. Not configured via code — requires manual one-time GitHub App installation.

## 7. npm Package Configuration

**package.json additions:**

```json
{
  "files": ["dist/"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/unity-indexer.git"
  },
  "keywords": ["unity", "mcp", "indexer", "model-context-protocol"]
}
```

**New script:**
- `prepublishOnly` — `npm run typecheck && npm run lint && npm run test && npm run build`

**Safety net:** `.npmignore` listing `src/`, `tests/`, `docs/`, `.github/`, `.claude/`, `.superpowers/`, `grammars/`, config files.

## 8. .gitignore Additions

Add to existing `.gitignore`:
```
.env*
*.tsbuildinfo
coverage/
.DS_Store
```

## 9. Code Quality Extras

### Test Coverage

**Dependency:** `@vitest/coverage-v8`

**Script:** `npm run test:coverage` — `vitest run --coverage`

CI reports coverage but does not gate on threshold.

### Unified CI Script

**Script:** `npm run ci` — `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`

Mirrors CI pipeline for local validation.

---

## New Dev Dependencies Summary

| Package | Purpose |
|---------|---------|
| `@eslint/js` | ESLint base recommended rules |
| `typescript-eslint` | TypeScript ESLint parser + rules |
| `eslint-config-prettier` | Disable ESLint rules that conflict with Prettier |
| `eslint` | Linter |
| `prettier` | Formatter |
| `husky` | Git hooks manager |
| `lint-staged` | Run linters on staged files |
| `@vitest/coverage-v8` | Test coverage via V8 |

## New Files Summary

| File | Purpose |
|------|---------|
| `eslint.config.js` | ESLint flat config |
| `.prettierrc` | Prettier config |
| `.prettierignore` | Prettier ignore patterns |
| `.npmignore` | npm publish ignore patterns |
| `.husky/pre-commit` | Pre-commit hook (lint-staged) |
| `.husky/pre-push` | Pre-push hook (typecheck) |
| `.github/workflows/ci.yml` | Main CI pipeline |
| `.github/workflows/security.yml` | Security scanning pipeline |
| `.github/dependabot.yml` | Dependabot config |

## Modified Files Summary

| File | Changes |
|------|---------|
| `package.json` | scripts, lint-staged, files, exports, types, license, repository, keywords, new devDependencies, prepare, prepublishOnly |
| `.gitignore` | Add .env*, *.tsbuildinfo, coverage/, .DS_Store |
