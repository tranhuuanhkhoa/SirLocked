# Plan 001: Gate Default Admin Seeding

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat ffc67d2..HEAD -- src/BE/Services/AuthService.cs src/BE/Program.cs src/BE/DTOs/Auth/AuthDtos.cs src/BE/Tests`
> If any in-scope file changed since this plan was written, compare the current state below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ffc67d2`, 2026-06-18

## Why this matters

The backend currently seeds a known demo admin account whenever no admin exists. That is convenient locally, but in a production deployment with an empty database it can create an administrator with a public default password. The fix should preserve local demo setup while requiring explicit production bootstrap configuration.

## Current state

- `src/BE/Services/AuthService.cs:19-20` defines `admin@sirlocked.local` and `Admin123!`.
- `src/BE/Services/AuthService.cs:87-101` seeds that admin if no `ADMIN` user exists.
- `src/BE/Program.cs:155-166` calls `SeedAdminAsync()` during startup after Mongo index setup.
- Repo convention: services throw `ApiException` for request failures, startup validation throws `InvalidOperationException`, and config is read through `builder.Configuration` in `Program.cs`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend tests | `dotnet test SirLocked.sln --no-build --no-restore` | exit 0, all tests pass |
| Backend build | `dotnet build SirLocked.sln` | exit 0 |
| Frontend typecheck | `cd src/FE && npm run typecheck` | exit 0, no errors |

## Scope

**In scope**:
- `src/BE/Services/AuthService.cs`
- `src/BE/Services/Interfaces/IAuthService.cs`
- `src/BE/Program.cs`
- `src/BE/Tests/` test files as needed
- README or operations docs only if they must document the new bootstrap behavior

**Out of scope**:
- Replacing the auth system.
- Changing JWT token shape.
- Creating a new admin-management UI.
- Printing or committing any real `.env` values.

## Steps

### Step 1: Introduce explicit seed policy

Add a small configuration-driven policy in `Program.cs`: allow demo admin seeding only in Development unless an explicit config flag such as `Auth:SeedDefaultAdmin=true` is present. In non-development environments, if no explicit flag is set, skip demo seeding and log a warning that bootstrap admin creation is disabled.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 2: Make `SeedAdminAsync` accept explicit credentials or skip

Change the auth service so default demo credentials are not hardwired into production startup. Use either an options object or method parameters so the caller decides whether seeding is allowed and which email/password to use. Keep `admin@sirlocked.local` and `Admin123!` only as development defaults.

**Verify**: `dotnet build SirLocked.sln` -> exit 0.

### Step 3: Add regression tests

Add tests proving:
- Development/default policy can seed the demo admin.
- Production/no-flag policy does not seed the demo admin.
- Explicit seed config in non-development can seed using provided credentials.

Prefer testing the policy/service seam directly instead of requiring a full web host if that keeps tests deterministic.

**Verify**: `dotnet test SirLocked.sln --no-build --no-restore` -> all tests pass, including the new admin seed tests.

### Step 4: Update docs

Update README or deployment docs to state that demo admin seeding is local-only by default and production bootstrap requires explicit configuration. Do not include any real secrets.

**Verify**: `rg -n "Admin123|SeedDefaultAdmin|admin@sirlocked.local" README.md ai-game-docs src/BE` -> all remaining references are intentional docs or development-only code.

## Test plan

- Add focused backend tests for seed policy and `SeedAdminAsync` behavior.
- Run `dotnet build SirLocked.sln`.
- Run `dotnet test SirLocked.sln --no-build --no-restore`.
- Run `cd src/FE && npm run typecheck` to confirm no frontend breakage.

## Done criteria

- [ ] Non-development startup does not silently create the known demo admin unless explicitly configured.
- [ ] Development startup still supports the current demo flow.
- [ ] New tests cover allowed and blocked seed paths.
- [ ] Docs describe production bootstrap behavior without secret values.
- [ ] `plans/README.md` row for plan 001 is updated.

## STOP conditions

- You discover an existing production bootstrap mechanism not captured here.
- The change requires altering JWT claims or public auth DTOs.
- Tests need a real shared MongoDB instance instead of an isolated/testable seam.

## Maintenance notes

Reviewers should scrutinize environment detection and logging. Future deployment work should replace ad hoc bootstrap secrets with a managed secret store or one-time setup command.
