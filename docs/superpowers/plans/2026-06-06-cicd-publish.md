# CI/CD Publish Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that auto-bumps version, runs CI, publishes to npm, generates a changelog, and creates a GitHub Release — triggered via `workflow_dispatch` with a release type selector.

**Architecture:** Single new workflow file. Changelog is generated inline via shell script parsing `git log` for conventional commit prefixes. No external tools or dependencies.

**Tech Stack:** GitHub Actions, npm CLI, git, gh CLI (pre-installed on GitHub runners).

---

## File Structure

### New Files

| File                            | Responsibility                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `.github/workflows/publish.yml` | Full publish pipeline: version bump → CI → npm publish → changelog → git tag → GitHub Release |

---

### Task 1: Create Publish Workflow

**Files:**

- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  workflow_dispatch:
    inputs:
      release_type:
        description: "Release type"
        required: true
        type: choice
        options:
          - patch
          - minor
          - major

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Bump version
        run: npm version ${{ inputs.release_type }} --no-git-tag-version

      - name: Read new version
        id: version
        run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Generate changelog
        id: changelog
        run: |
          PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
          if [ -z "$PREV_TAG" ]; then
            COMMITS=$(git log --pretty=format:"%s" --no-merges)
          else
            COMMITS=$(git log "${PREV_TAG}..HEAD" --pretty=format:"%s" --no-merges)
          fi

          FEATURES=""
          FIXES=""
          PERF=""
          DOCS=""
          MAINTENANCE=""

          while IFS= read -r line; do
            msg="${line#*: }"
            case "$line" in
              feat:*|feat\(*) FEATURES="${FEATURES}- ${msg}\n" ;;
              fix:*|fix\(*) FIXES="${FIXES}- ${msg}\n" ;;
              perf:*|perf\(*) PERF="${PERF}- ${msg}\n" ;;
              docs:*|docs\(*) DOCS="${DOCS}- ${msg}\n" ;;
              *) MAINTENANCE="${MAINTENANCE}- ${msg}\n" ;;
            esac
          done <<< "$COMMITS"

          CHANGELOG="## What's Changed\n\n"
          [ -n "$FEATURES" ] && CHANGELOG="${CHANGELOG}### Features\n\n${FEATURES}\n"
          [ -n "$FIXES" ] && CHANGELOG="${CHANGELOG}### Bug Fixes\n\n${FIXES}\n"
          [ -n "$PERF" ] && CHANGELOG="${CHANGELOG}### Performance\n\n${PERF}\n"
          [ -n "$DOCS" ] && CHANGELOG="${CHANGELOG}### Documentation\n\n${DOCS}\n"
          [ -n "$MAINTENANCE" ] && CHANGELOG="${CHANGELOG}### Maintenance\n\n${MAINTENANCE}\n"

          {
            echo "body<<CHANGELOG_EOF"
            echo -e "$CHANGELOG"
            echo "CHANGELOG_EOF"
          } >> "$GITHUB_OUTPUT"

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Commit version bump
        run: |
          git add package.json package-lock.json
          git commit -m "chore: release v${{ steps.version.outputs.version }} [skip ci]"

      - name: Create tag
        run: git tag "v${{ steps.version.outputs.version }}"

      - name: Push commit and tag
        run: git push origin main --tags

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "v${{ steps.version.outputs.version }}" \
            --title "v${{ steps.version.outputs.version }}" \
            --notes "${{ steps.changelog.outputs.body }}"
```

- [ ] **Step 2: Validate YAML syntax**

Run:

```bash
node -e "const y=require('yaml'),f=require('fs'); y.parse(f.readFileSync('.github/workflows/publish.yml','utf8')); console.log('Valid')"
```

Expected: `Valid`

- [ ] **Step 3: Verify all other workflows still parse**

Run:

```bash
node -e "const y=require('yaml'),f=require('fs'); ['ci.yml','security.yml','publish.yml'].forEach(w => { y.parse(f.readFileSync('.github/workflows/'+w,'utf8')); }); console.log('All valid')"
```

Expected: `All valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add publish workflow with auto version bump and changelog"
```

---

### Task 2: Validation

- [ ] **Step 1: Verify existing CI still passes**

Run: `npm run ci`

Expected: typecheck, lint, format:check, test, build all pass. The new workflow file doesn't affect local CI.

- [ ] **Step 2: Verify workflow file structure**

Run:

```bash
ls -la .github/workflows/
```

Expected: Three workflow files: `ci.yml`, `security.yml`, `publish.yml`.

- [ ] **Step 3: Inspect workflow for common issues**

Run:

```bash
grep -n "NPM_TOKEN\|GITHUB_TOKEN\|workflow_dispatch\|npm publish\|gh release" .github/workflows/publish.yml
```

Expected: All key elements present — `NPM_TOKEN` referenced for publish, `GITHUB_TOKEN` for release, `workflow_dispatch` as trigger, `npm publish` command, `gh release create` command.

- [ ] **Step 4: Reminder — one-time manual setup**

These steps must be done manually before the first release:

1. **npm token:** Create a granular access token at npmjs.com → Access Tokens → Generate New Token → Granular Access Token. Scope: publish-only for `unity-indexer` package.
2. **GitHub secret:** Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Name: `NPM_TOKEN`. Value: the npm token from step 1.
3. **Branch protection (if enabled):** Go to Settings → Branches → `main` rule → check "Allow specified actors to bypass required pull requests" → add `github-actions[bot]`.
