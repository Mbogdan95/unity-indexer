# CI/CD Pipeline — Publish Workflow Design

**Date:** 2026-06-06
**Scope:** Add automated npm publish workflow triggered via `workflow_dispatch`. Auto-bumps version, creates git tag, runs CI, publishes to npm, generates changelog, creates GitHub Release.
**Approach:** Single new workflow file. No external tools — uses git log parsing for changelog.

---

## Existing CI/CD (Already Implemented)

- `ci.yml` — typecheck, lint, format, test, build on Node 18/20/22 (push to main + PRs)
- `security.yml` — npm audit + CodeQL (push to main + PRs + weekly)
- `dependabot.yml` — weekly npm + GitHub Actions updates

## New: Publish Workflow (`.github/workflows/publish.yml`)

### Trigger

`workflow_dispatch` with required input:

| Input          | Type   | Options                   | Description      |
| -------------- | ------ | ------------------------- | ---------------- |
| `release_type` | choice | `patch`, `minor`, `major` | Semver bump type |

### Flow

1. **Checkout** `main` branch with full git history (`fetch-depth: 0` for changelog generation)
2. **Setup Node 22** with npm registry auth (`registry-url: https://registry.npmjs.org`)
3. **Install** dependencies (`npm ci`)
4. **Bump version** — `npm version {release_type} --no-git-tag-version` (updates `package.json` and `package-lock.json` without creating a git tag yet)
5. **Read new version** — extract from `package.json` into workflow variable
6. **Run CI checks** — `npm run typecheck && npm run lint && npm run test && npm run build` (fail-fast: if any check fails, nothing is published)
7. **Publish to npm** — `npm publish` using `NPM_TOKEN` secret
8. **Generate changelog** — parse conventional commits since last tag, group by type, format as markdown
9. **Commit version bump** — commit `package.json` and `package-lock.json` with message `chore: release v{version} [skip ci]`
10. **Create git tag** — `git tag v{version}`
11. **Push** commit and tag to `main`
12. **Create GitHub Release** — via `gh release create v{version}` with generated changelog as body

### Ordering Rationale

- CI checks run BEFORE publish — broken code never reaches npm
- npm publish happens BEFORE git push — if publish fails, no tag/release is created
- Git push and GitHub Release happen last — they're reversible; npm publish is not

### Changelog Generation

Built into the workflow as a shell script step. No external dependency.

**Logic:**

1. Find previous tag: `git describe --tags --abbrev=0 HEAD~1` (or empty if first release)
2. Collect commits: `git log {prev_tag}..HEAD --pretty=format:"%s"`
3. Group by conventional commit prefix:
   - `feat:` → **Features**
   - `fix:` → **Bug Fixes**
   - `perf:` → **Performance**
   - `docs:` → **Documentation**
   - `chore:`, `ci:`, `style:`, `refactor:`, `test:` → **Maintenance**
4. Format as markdown with bullet points
5. First release (no previous tag): include all commits

**Output format:**

```markdown
## What's Changed

### Features

- add CLI install/uninstall for Claude Code settings
- add settings scope resolution

### Bug Fixes

- catch parseArgs errors for clean CLI error output

### Maintenance

- configure npm package fields
```

### Required Secrets

| Secret      | Where                                      | Purpose                    |
| ----------- | ------------------------------------------ | -------------------------- |
| `NPM_TOKEN` | GitHub repo → Settings → Secrets → Actions | npm publish authentication |

`GITHUB_TOKEN` is provided automatically — used for `gh release create` and pushing to `main`.

### Workflow Permissions

```yaml
permissions:
  contents: write
```

`contents: write` covers: pushing commits/tags to `main`, creating GitHub Releases.

### Branch Protection Consideration

If branch protection is enabled on `main` requiring PR reviews, the workflow's push will fail. Two options:

1. Allow `github-actions[bot]` to bypass branch protection rules
2. Use a Personal Access Token (PAT) instead of `GITHUB_TOKEN` for the push step

Recommend option 1 — simpler, no extra secrets.

### Error Handling

| Failure point          | Effect                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| CI checks fail         | Workflow stops. Nothing published, no tag, no release.                                        |
| npm publish fails      | Workflow stops. Version bump committed locally but not pushed. No tag, no release.            |
| Git push fails         | npm package is published but no GitHub Release. Manual recovery: push tag and create release. |
| Release creation fails | npm package published, tag pushed. Manual recovery: create release via GitHub UI.             |

### Release Flow (User Experience)

1. Merge PRs to `main` using conventional commits (`feat:`, `fix:`, etc.)
2. Go to GitHub → Actions → "Publish" workflow
3. Click "Run workflow"
4. Select `patch`, `minor`, or `major`
5. Wait ~2 minutes
6. Result: npm package published, GitHub Release created with auto-generated changelog, `package.json` version bumped on `main`

### One-Time Setup

1. Create npm access token (granular, publish-only for `unity-indexer` package)
2. Add as `NPM_TOKEN` secret in GitHub repo settings
3. If branch protection is on `main`: allow `github-actions[bot]` to bypass

## Files Summary

| File                            | Action                         |
| ------------------------------- | ------------------------------ |
| `.github/workflows/publish.yml` | Create — full publish workflow |
