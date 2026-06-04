# Project Tooling & Code Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add linting, formatting, type checking, security scanning, CI/CD, pre-commit hooks, and npm package configuration to unity-indexer.

**Architecture:** All tooling added in one pass. Prettier formats first (big diff), then ESLint fixes (separate diff), then remaining config files are new files only. Order matters — Prettier before ESLint so formatting is settled before lint fixes.

**Tech Stack:** ESLint 9 (flat config), typescript-eslint v8, Prettier, Husky v9, lint-staged, GitHub Actions, CodeQL, Dependabot, vitest coverage v8.

---

## File Structure

### New Files

| File                             | Responsibility                                      |
| -------------------------------- | --------------------------------------------------- |
| `eslint.config.js`               | ESLint flat config — rules, ignores, test overrides |
| `.prettierrc`                    | Prettier formatting options                         |
| `.prettierignore`                | Files Prettier should skip                          |
| `.npmignore`                     | Files excluded from npm package                     |
| `.husky/pre-commit`              | Git hook — runs lint-staged                         |
| `.husky/pre-push`                | Git hook — runs typecheck                           |
| `.github/workflows/ci.yml`       | CI pipeline — typecheck, lint, format, test, build  |
| `.github/workflows/security.yml` | Security pipeline — npm audit, CodeQL               |
| `.github/dependabot.yml`         | Dependabot config for npm + actions                 |

### Modified Files

| File               | Changes                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `package.json`     | devDependencies, scripts, lint-staged, files, exports, types, license, keywords, prepare, prepublishOnly |
| `.gitignore`       | Add .env*, *.tsbuildinfo, coverage/, .DS_Store                                                           |
| `vitest.config.ts` | Add coverage config                                                                                      |
| `src/**/*.ts`      | Prettier formatting + ESLint fixes                                                                       |
| `tests/**/*.ts`    | Prettier formatting                                                                                      |

---

### Task 1: Install all dev dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install linting and formatting dependencies**

```bash
npm install --save-dev eslint @eslint/js typescript-eslint eslint-config-prettier prettier
```

- [ ] **Step 2: Install git hooks dependencies**

```bash
npm install --save-dev husky lint-staged
```

- [ ] **Step 3: Install coverage dependency**

```bash
npm install --save-dev @vitest/coverage-v8
```

- [ ] **Step 4: Verify installation**

Run: `node -e "require('eslint'); require('prettier')" 2>&1 || echo "OK - ESM packages"` and `ls node_modules/eslint node_modules/prettier node_modules/husky node_modules/lint-staged node_modules/@vitest/coverage-v8`

Expected: All directories exist.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install linting, formatting, hooks, and coverage dev dependencies"
```

---

### Task 2: Prettier config + format codebase

**Files:**

- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `src/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`, `tsconfig.json`

- [ ] **Step 1: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 2: Create `.prettierignore`**

```
dist/
node_modules/
*.db
package-lock.json
grammars/
coverage/
```

- [ ] **Step 3: Add format scripts to `package.json`**

Add to `"scripts"`:

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 4: Run Prettier on entire codebase**

Run: `npx prettier --write .`

Expected: All files formatted. Output shows list of changed files.

- [ ] **Step 5: Verify formatting is clean**

Run: `npx prettier --check .`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "style: format codebase with Prettier"
```

---

### Task 3: ESLint flat config + fix lint errors

**Files:**

- Create: `eslint.config.js`
- Modify: `src/**/*.ts` (lint fixes)

- [ ] **Step 1: Create `eslint.config.js`**

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/", "grammars/", "**/*.js"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
```

**Note:** `import.meta.dirname` requires Node 20.11+. If Node 18 support is needed, replace with:

```js
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// then use: dirname(fileURLToPath(import.meta.url))
```

- [ ] **Step 2: Add lint scripts to `package.json`**

Add to `"scripts"`:

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

- [ ] **Step 3: Run ESLint to see all violations**

Run: `npx eslint . 2>&1 | tail -20`

Expected: List of violations. Take note of the count.

- [ ] **Step 4: Auto-fix what ESLint can fix**

Run: `npx eslint . --fix`

This handles `consistent-type-imports` (adds `type` keyword) and some other auto-fixable rules.

- [ ] **Step 5: Fix remaining violations manually**

Run: `npx eslint . 2>&1`

Common fixes needed:

- `strict-boolean-expressions`: Change `if (value)` to `if (value !== undefined)` or `if (value != null)` for nullable types. For strings, use `if (value !== "")` or `if (value.length > 0)`.
- `no-explicit-any`: Replace `any` with `unknown` or proper types. Cast with `as Type` where the type is truly known.
- `no-unsafe-*` rules: Add type narrowing or proper typing for values coming from `Record<string, unknown>` or parsed YAML.
- `no-floating-promises`: Add `void` prefix or `await` to unhandled promises.
- `no-unnecessary-condition`: Remove redundant null checks where TypeScript proves a value can't be null.

Fix each file until `npx eslint .` reports zero errors.

- [ ] **Step 6: Verify zero lint errors**

Run: `npx eslint .`

Expected: No output (clean).

- [ ] **Step 7: Run Prettier again to ensure lint fixes didn't break formatting**

Run: `npx prettier --write .`

- [ ] **Step 8: Verify tests still pass**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix: resolve all ESLint strict type-checked violations"
```

---

### Task 4: Update .gitignore and npm package config

**Files:**

- Modify: `.gitignore`
- Modify: `package.json`
- Create: `.npmignore`

- [ ] **Step 1: Add entries to `.gitignore`**

Append to existing `.gitignore`:

```
.env*
*.tsbuildinfo
coverage/
.DS_Store
```

- [ ] **Step 2: Create `.npmignore`**

```
src/
tests/
docs/
.github/
.claude/
.superpowers/
grammars/
coverage/
.prettierrc
.prettierignore
eslint.config.js
vitest.config.ts
tsconfig.json
.gitignore
*.db
```

- [ ] **Step 3: Add npm package fields to `package.json`**

Add these top-level fields:

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
  "keywords": ["unity", "mcp", "indexer", "model-context-protocol"]
}
```

**Note:** Add `"repository"` field once a GitHub remote is configured. Placeholder:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/OWNER/unity-indexer.git"
}
```

- [ ] **Step 4: Verify package contents**

Run: `npm pack --dry-run 2>&1`

Expected: Only `dist/` files and `package.json` listed. No `src/`, `tests/`, or config files.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .npmignore package.json
git commit -m "chore: configure npm package fields, .gitignore, and .npmignore"
```

---

### Task 5: Add remaining package.json scripts

**Files:**

- Modify: `package.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add coverage config to `vitest.config.ts`**

Replace the full file content with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: ["node_modules/", "dist/", "tests/", "*.config.*"],
    },
  },
});
```

- [ ] **Step 2: Add all remaining scripts to `package.json`**

The full `"scripts"` section should be:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx src/index.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "ci": "npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build",
  "prepare": "husky",
  "prepublishOnly": "npm run typecheck && npm run lint && npm run test && npm run build"
}
```

- [ ] **Step 3: Verify scripts work**

Run each:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

Expected: All pass with zero errors.

- [ ] **Step 4: Run coverage**

Run: `npm run test:coverage`

Expected: Tests pass, coverage summary printed, `coverage/` directory created.

- [ ] **Step 5: Run unified CI script**

Run: `npm run ci`

Expected: All steps pass sequentially.

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.ts
git commit -m "chore: add typecheck, coverage, ci, and prepublishOnly scripts"
```

---

### Task 6: Husky + lint-staged

**Files:**

- Modify: `package.json`
- Create: `.husky/pre-commit`
- Create: `.husky/pre-push`

- [ ] **Step 1: Initialize Husky**

Run: `npx husky init`

This creates `.husky/` directory and a default `pre-commit` hook.

- [ ] **Step 2: Add lint-staged config to `package.json`**

Add top-level:

```json
"lint-staged": {
  "*.ts": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

- [ ] **Step 3: Write `.husky/pre-commit` hook**

Replace the default content with:

```bash
npx lint-staged
```

- [ ] **Step 4: Write `.husky/pre-push` hook**

Create `.husky/pre-push`:

```bash
npm run typecheck
```

- [ ] **Step 5: Verify pre-commit hook works**

Create a test: stage a file with bad formatting, then commit. The hook should auto-fix it.

```bash
echo "const   x=1;" >> /tmp/test-lint.ts
```

Instead, just verify lint-staged runs:

```bash
npx lint-staged --debug 2>&1 | head -5
```

Expected: lint-staged initializes and runs (may show "No staged files" if nothing is staged).

- [ ] **Step 6: Commit**

```bash
git add .husky/ package.json
git commit -m "chore: configure Husky pre-commit (lint-staged) and pre-push (typecheck) hooks"
```

---

### Task 7: GitHub Actions CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: true
      matrix:
        node-version: [18, 20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Check formatting
        run: npm run format:check

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build
```

- [ ] **Step 3: Validate YAML syntax**

Run: `node -e "const fs = require('fs'); const yaml = require('yaml'); yaml.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8')); console.log('Valid YAML')"`

Expected: `Valid YAML`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI workflow with Node 18/20/22 matrix"
```

---

### Task 8: GitHub Actions security workflow + Dependabot

**Files:**

- Create: `.github/workflows/security.yml`
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create `.github/workflows/security.yml`**

```yaml
name: Security

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 0 * * 0"

permissions:
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: npm audit
        run: npm audit --audit-level=high

  codeql:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
```

- [ ] **Step 2: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

- [ ] **Step 3: Validate YAML syntax**

Run: `node -e "const fs = require('fs'); const yaml = require('yaml'); ['security.yml', '../dependabot.yml'].forEach(f => { yaml.parse(fs.readFileSync('.github/workflows/../' + (f.startsWith('../') ? f.slice(3) : 'workflows/' + f), 'utf8')); }); console.log('Valid YAML')"`

Or more simply:

```bash
node -e "const y=require('yaml'),f=require('fs'); y.parse(f.readFileSync('.github/workflows/security.yml','utf8')); y.parse(f.readFileSync('.github/dependabot.yml','utf8')); console.log('Valid')"
```

Expected: `Valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/security.yml .github/dependabot.yml
git commit -m "ci: add security scanning (npm audit, CodeQL) and Dependabot config"
```

---

### Task 9: Final validation

- [ ] **Step 1: Run full CI script locally**

Run: `npm run ci`

Expected: All steps pass — typecheck, lint, format:check, test, build.

- [ ] **Step 2: Verify coverage works**

Run: `npm run test:coverage`

Expected: Tests pass, coverage report printed.

- [ ] **Step 3: Verify package contents**

Run: `npm pack --dry-run 2>&1`

Expected: Only `dist/**` files and `package.json` in the package.

- [ ] **Step 4: Verify git hooks are installed**

Run: `ls -la .husky/pre-commit .husky/pre-push`

Expected: Both files exist and are executable.

- [ ] **Step 5: Reminder — manual steps**

These require manual action outside this plan:

1. **Socket.dev**: Install the Socket GitHub App from GitHub Marketplace on the repository. Free for open source.
2. **Repository field**: Once a GitHub remote is configured, update `"repository"` in `package.json` with the actual URL.
3. **Branch protection**: Enable branch protection on `main` requiring CI checks to pass before merge.
