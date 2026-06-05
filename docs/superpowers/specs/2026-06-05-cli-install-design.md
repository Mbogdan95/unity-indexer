# CLI Install/Uninstall Command Design

**Date:** 2026-06-05
**Scope:** Add `install` and `uninstall` subcommands to unity-indexer CLI for registering/removing the MCP server in Claude Code settings. Support four scopes: global, local, project, project-local.
**Approach:** Minimal CLI parser — no framework. Two new files in `src/cli/`.

---

## 1. CLI Entry Point (`src/index.ts`)

Check `argv[2]` before starting MCP server. If it's a known command or flag, dispatch to CLI handler. Otherwise, run MCP server as before.

```
unity-indexer                          → MCP server (cwd as root)
unity-indexer /path                    → MCP server (path as root)
unity-indexer install                  → install to global scope (default)
unity-indexer install --scope project  → install to project scope
unity-indexer uninstall                → uninstall from global scope
unity-indexer uninstall --scope local  → uninstall from local scope
unity-indexer --help                   → show usage info
unity-indexer --version                → print version from package.json
unity-indexer install --help           → show install-specific help
```

`--help`/`-h` and `--version`/`-v` are top-level flags. Subcommands also accept `--help`. Version reads from `package.json` at runtime.

## 2. Settings Manager (`src/cli/settings.ts`)

Core logic for reading/writing Claude Code settings files.

### Scope Resolution

| Scope           | File path                           |
| --------------- | ----------------------------------- |
| `global`        | `~/.claude/settings.json`           |
| `local`         | `~/.claude/settings.local.json`     |
| `project`       | `{cwd}/.claude/settings.json`       |
| `project-local` | `{cwd}/.claude/settings.local.json` |

### Install Behavior

1. Resolve settings file path from scope
2. Read existing file (or `{}` if doesn't exist)
3. Ensure `mcpServers` key exists
4. Add/overwrite `unity-indexer` entry
5. Write back with 2-space JSON indent
6. Create parent directories if needed (`.claude/` for project scopes)
7. Print success message with scope and file path

### MCP Server Config Entry

```json
{
  "mcpServers": {
    "unity-indexer": {
      "command": "npx",
      "args": ["-y", "unity-indexer"]
    }
  }
}
```

`npx -y` ensures it works regardless of install method. If globally installed, `npx` resolves the global binary.

### Uninstall Behavior

1. Resolve settings file path from scope
2. Read settings file — error if file doesn't exist
3. Error if `unity-indexer` not present in `mcpServers`
4. Remove `unity-indexer` from `mcpServers`
5. Preserve all other settings and servers
6. Write back
7. Print success message

### Edge Cases

- File doesn't exist: create on install, error on uninstall
- `unity-indexer` already registered: overwrite on install (idempotent)
- `unity-indexer` not in settings: error on uninstall with message
- `.claude/` directory doesn't exist: create it for project scopes on install
- Other `mcpServers` entries: always preserved
- Non-`mcpServers` settings: always preserved

## 3. CLI Parser (`src/cli/cli.ts`)

Minimal arg parser. Exports a single function that parses `process.argv.slice(2)` and returns a discriminated union describing what to do.

### Parse Rules

- `--help` or `-h` anywhere → help action
- `--version` or `-v` → version action
- First positional is `install` → install action, parse `--scope` (default: `global`)
- First positional is `uninstall` → uninstall action, parse `--scope` (default: `global`)
- Anything else → server action (existing behavior)
- Invalid `--scope` value → error with list of valid scopes

### Help Output

```
unity-indexer v{version}
Unity-specialized MCP server for token-efficient code exploration

Usage:
  unity-indexer [project-root]      Start MCP server
  unity-indexer install [options]   Register in Claude Code settings
  unity-indexer uninstall [options] Remove from Claude Code settings

Options:
  --scope <scope>  Target scope (default: global)
                   global        ~/.claude/settings.json
                   local         ~/.claude/settings.local.json
                   project       .claude/settings.json
                   project-local .claude/settings.local.json
  --help, -h       Show this help
  --version, -v    Show version
```

## 4. File Structure

### New Files

| File                         | Responsibility                           |
| ---------------------------- | ---------------------------------------- |
| `src/cli/cli.ts`             | Arg parsing, help text, version printing |
| `src/cli/settings.ts`        | Read/write Claude Code settings files    |
| `tests/cli/cli.test.ts`      | CLI parser unit tests                    |
| `tests/cli/settings.test.ts` | Settings manager unit tests              |

### Modified Files

| File           | Changes                                            |
| -------------- | -------------------------------------------------- |
| `src/index.ts` | Dispatch to CLI handler before starting MCP server |

## 5. Testing

### Settings Manager Tests (`tests/cli/settings.test.ts`)

All tests use temp directories — no touching real `~/.claude/`.

- Install to each scope writes correct config to correct path
- Install when file doesn't exist creates file and parent dirs
- Install when `mcpServers` already has other servers preserves them
- Install when `unity-indexer` already exists overwrites it (idempotent)
- Uninstall removes entry, preserves other servers
- Uninstall when file doesn't exist throws error
- Uninstall when `unity-indexer` not present throws error
- Non-`mcpServers` settings are preserved through install/uninstall

### CLI Parser Tests (`tests/cli/cli.test.ts`)

- `--help` returns help action
- `--version` returns version action
- `install` with no scope defaults to `global`
- `install --scope project` returns correct scope
- `install --scope invalid` throws error
- `uninstall --scope local` returns correct scope
- No args returns server action
- Unknown positional treated as project root (server action)
