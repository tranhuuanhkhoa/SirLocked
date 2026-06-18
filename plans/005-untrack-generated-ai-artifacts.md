# Plan 005: Untrack Generated AI Artifacts

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat ffc67d2..HEAD -- .gitignore README.md src/BE/SirLocked.Api.csproj src/BE/GeneratedCaseJson src/FE/public/assets/ai-generated`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `ffc67d2`, 2026-06-18

## Why this matters

Generated AI case JSON and generated image assets are currently tracked even though the README and `.gitignore` say they should be ignored. This bloats diffs, makes generated runtime output look like source, and increases the chance of accidentally reviewing or shipping stale generated artifacts. The local files should be preserved while git stops tracking them.

## Current state

- `.gitignore:26-27` ignores `src/BE/GeneratedCaseJson/` and `src/FE/public/assets/ai-generated/`.
- `README.md:98` says generated bundles and image assets are ignored by git.
- `src/BE/SirLocked.Api.csproj:17-18` excludes `GeneratedCaseJson/**` from publish output.
- Audit found tracked files under both generated paths.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inventory tracked JSON | `git ls-files src/BE/GeneratedCaseJson` | initially non-empty, finally empty |
| Inventory tracked assets | `git ls-files src/FE/public/assets/ai-generated` | initially non-empty, finally empty |
| Backend tests | `dotnet test SirLocked.sln --no-build --no-restore` | exit 0, all tests pass |
| Frontend typecheck | `cd src/FE && npm run typecheck` | exit 0, no errors |

## Scope

**In scope**:
- Git index entries under `src/BE/GeneratedCaseJson/`
- Git index entries under `src/FE/public/assets/ai-generated/`
- `.gitignore` only if ignore coverage is incomplete
- README only if wording needs clarification

**Out of scope**:
- Deleting local generated files from disk.
- Changing the AI generation pipeline.
- Changing generated case schema.
- Removing committed seed/sample cases outside these generated paths.

## Steps

### Step 1: Inventory tracked generated files

Run:
- `git ls-files src/BE/GeneratedCaseJson`
- `git ls-files src/FE/public/assets/ai-generated`

Record counts in the commit message or PR notes. Do not print or copy generated content into docs.

**Verify**: both commands show the currently tracked generated paths.

### Step 2: Stop tracking while preserving local files

Run git index removal with cached mode:
- `git rm -r --cached src/BE/GeneratedCaseJson`
- `git rm -r --cached src/FE/public/assets/ai-generated`

Do not use plain `rm`, `Remove-Item`, or any command that deletes local files.

**Verify**: `Test-Path src/BE/GeneratedCaseJson` and `Test-Path src/FE/public/assets/ai-generated` both return `True`.

### Step 3: Confirm ignore behavior

Run:
- `git status --short`
- `git ls-files src/BE/GeneratedCaseJson`
- `git ls-files src/FE/public/assets/ai-generated`

The generated files should appear as staged deletions in git status, not as untracked additions. The `git ls-files` commands should return no files after the index update.

**Verify**: generated paths are not re-added as untracked files.

### Step 4: Run lightweight verification

Run backend tests and frontend typecheck. This plan should not affect compiled source.

**Verify**:
- `dotnet test SirLocked.sln --no-build --no-restore` -> all tests pass.
- `cd src/FE && npm run typecheck` -> exit 0.

## Test plan

- Git inventory before and after cached removal.
- Confirm local generated folders still exist.
- Backend tests and frontend typecheck.
- Optional local app smoke: create/list cases only if an operator asks for runtime verification.

## Done criteria

- [ ] `git ls-files src/BE/GeneratedCaseJson` returns no tracked files.
- [ ] `git ls-files src/FE/public/assets/ai-generated` returns no tracked files.
- [ ] Local generated folders are still present after cached removal.
- [ ] `.gitignore` continues to ignore both paths.
- [ ] `plans/README.md` row for plan 005 is updated.

## STOP conditions

- The operator explicitly wants any generated bundle to remain tracked as a fixture.
- Cached removal would remove a non-generated canonical sample case.
- Local generated folders disappear from disk.

## Maintenance notes

If tests need fixed generated fixtures later, place small curated fixtures under a clearly named test fixture path instead of these runtime output directories.
