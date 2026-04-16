# Contributing to the Adventure.fun Agent SDK

## Development Workflows

There are two ways to develop the SDK depending on what you're changing.

### Standalone Development (SDK-only changes)

For changes that only affect the SDK -- new modules, LLM adapter improvements, chat features, documentation, tests, etc.

```bash
git clone https://github.com/adventure-fun/agent-sdk.git
cd agent-sdk
bun install
bun test                    # run all tests
bun run typecheck           # verify types
bun run build               # produce dist/
```

Make your changes, write tests first (red/green TDD), then submit a PR to the standalone repo.

### Monorepo Development (engine/schema changes that affect the SDK)

When changes to `shared/schemas/`, `shared/engine/`, or `backend/` affect the SDK, development happens in the [core monorepo](https://github.com/adventure-fun/core) where both the canonical sources and the SDK live side by side.

```bash
git clone --recurse-submodules https://github.com/adventure-fun/core.git
cd core
bun install
```

After editing canonical source files:

```bash
# Regenerate vendored protocol, dev engine, and sync manifest
bun run scripts/sync-sdk-types.ts

# Verify the SDK still works with the updated vendored files
cd agent-sdk && bun test && bun run typecheck
```

Commit both the monorepo changes and the SDK changes together. The monorepo CI (`sdk-sync-check` job) will block merge if vendored files are out of sync.

---

## Sync Tracking

The SDK vendors its own copy of protocol types and dev engine files from the monorepo so it can build and run standalone without private monorepo packages. A CI-enforced sync tracking system detects drift.

### What is tracked

The sync manifest (`agent-sdk/.sync-manifest.json`) tracks:

- **Protocol types** -- 29 type exports from `shared/schemas/src/index.ts`, each with an individual SHA-256 hash. The vendored copy lives at `agent-sdk/src/protocol.ts`.
- **Engine watchlist** -- 19 engine and backend files whose changes may affect SDK module behavior (combat math, turn resolution, auth, payments, lobby chat, etc.). Each file maps to the SDK modules it affects.
- **Dev engine watchlist** -- 9 source-to-vendored file pairs for the local development stack (`agent-sdk/dev/engine/`).

### Developer commands

| Command | Purpose |
|---------|---------|
| `bun run scripts/sync-sdk-types.ts` | Regenerate vendored protocol + dev engine + manifest |
| `bun run scripts/check-sdk-sync.ts` | Read-only verification (used by CI) |

### How it works

1. `scripts/sync-sdk-types.ts` reads canonical sources, generates vendored files, and writes the manifest with current hashes.
2. `scripts/check-sdk-sync.ts` compares the manifest against current source files. If any hashes differ, it fails with actionable output telling you which files changed and which SDK modules to review.
3. The monorepo CI runs `check-sdk-sync.ts` on every PR before tests. The standalone repo CI does **not** run sync checks (it has no access to the canonical sources).

### Standalone repo CI

The standalone repo at `github.com/adventure-fun/agent-sdk` runs its own CI:

- TypeScript typecheck (`bun run typecheck`)
- Unit tests (`bun test tests/unit/`)
- Build (`bun run build`)

Integration tests require the local development stack (Docker) and are not included in CI.

---

## Submodule Extraction

The SDK lives inside the monorepo at `agent-sdk/` during development and is mirrored to `https://github.com/adventure-fun/agent-sdk` as a standalone repository. The one-time extraction procedure to convert it to a git submodule is documented below.

### Initial push to the standalone repo

```bash
cd agent-sdk
git init
git remote add origin https://github.com/adventure-fun/agent-sdk.git
git add .
git commit -m "Initial SDK extraction from monorepo"
git push -u origin main
```

### Convert to submodule in the monorepo

```bash
cd /path/to/core
git rm -r agent-sdk
git submodule add -b main https://github.com/adventure-fun/agent-sdk.git agent-sdk
git commit -m "Convert agent-sdk to git submodule"
```

### Clone with submodules

After the submodule is set up, all contributors should clone with:

```bash
git clone --recurse-submodules https://github.com/adventure-fun/core.git
```

Or initialize submodules in an existing clone:

```bash
git submodule update --init --recursive
```

### Updating the submodule pointer

After pushing changes to the standalone repo, update the monorepo's submodule pointer:

```bash
cd agent-sdk
git pull origin main
cd ..
git add agent-sdk
git commit -m "Update agent-sdk submodule"
```

---

## Code Standards

- **TDD** -- write failing tests first, then implement until green
- **No monorepo imports** -- `agent-sdk/src/` must never import from `@adventure-fun/schemas`, `@adventure-fun/engine`, or `@adventure-fun/server`
- **Security** -- chat messages are untrusted input; never mix them into game decision LLM prompts
- **Types** -- strict TypeScript; `bun run typecheck` must pass

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Write tests first (red/green TDD)
4. Run `bun test` and `bun run typecheck`
5. If you changed vendored types, run `bun run scripts/sync-sdk-types.ts` (monorepo only)
6. Submit a pull request
