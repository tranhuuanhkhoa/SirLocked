# Plan 011: Partition authentication rate limits by client IP

> **Executor instructions**: Follow the plan step by step and run every verification command. Do not trust arbitrary forwarding headers. Stop if deployment topology makes the client address ambiguous. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 6869c99..HEAD -- src/BE/Program.cs src/BE/WebAPI/Controllers/AuthController.cs src/BE/Tests/SirLocked.Tests.csproj`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6869c99`, 2026-07-13
- **Execution timing**: deferred by the owner until a public or staging deployment exists, so client IP and trusted-proxy behavior can be tested against the real topology.

Do not execute this plan during local-only development unless the owner explicitly reactivates it. Before implementation, reconcile the plan against the deployed reverse proxy/CDN and obtain explicit trusted proxy/network values; never infer them.

## Why this matters

Comments promise per-IP login/register/email throttling, but `AddFixedWindowLimiter` creates one shared limiter per policy name. Five login attempts from one client can consume the login budget for every user. Partitioned policies preserve abuse protection while preventing accidental or malicious global denial of authentication.

## Current state

- `src/BE/Program.cs:79-117` registers three global fixed-window limiters.
- `src/BE/WebAPI/Controllers/AuthController.cs:20-30,80-105` applies the named policies to register, login, forgot-password, and resend-verification.
- `src/BE/Program.cs:208-217` runs rate limiting before authentication.
- The test project has xUnit and references the API project; internal helpers are visible through `InternalsVisibleTo`.

Current global registration:

```csharp
// Program.cs:82-88
options.AddFixedWindowLimiter("login", config =>
{
    config.PermitLimit = 5;
    config.Window = TimeSpan.FromMinutes(1);
    config.QueueLimit = 0;
});
```

## Target contract

- Each policy uses a partition key derived from `HttpContext.Connection.RemoteIpAddress`.
- Same IP shares its policy budget; different IPs do not.
- Login remains 5/minute, register 3/5 minutes, email 3/5 minutes.
- Missing remote IP uses one explicit fallback partition and is covered by a test.
- Do not read `X-Forwarded-For` directly. ASP.NET may use forwarded headers only when trusted proxies/networks are explicitly configured by deployment.
- Existing controller attributes and JSON API response shape remain unchanged.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore --filter FullyQualifiedName~AuthRateLimit` | exit 0, all selected tests pass |
| Backend suite | `dotnet test SirLocked.sln --no-restore` | exit 0 |
| Build | `dotnet build SirLocked.sln --no-restore` | exit 0 |

## Scope

**In scope**:

- `src/BE/Program.cs`
- `src/BE/WebAPI/Extensions/AuthRateLimitPolicies.cs` (create; exact folder may be `WebAPI/Extensions` to match existing organization)
- `src/BE/Tests/AuthRateLimitPolicyTests.cs` (create)
- `src/BE/WebAPI/Controllers/AuthController.cs` only if policy constants replace string literals

**Out of scope**:

- Changing password, JWT, refresh-token, Google OAuth, email, or account-lock behavior.
- Adding CAPTCHA, distributed Redis rate limiting, or rate limits for AI generation.
- Trusting arbitrary proxy headers.
- Adding new rate limits to reset-password/verify-email in this plan.
- Production proxy configuration without explicit operator-provided trusted proxy addresses.

## Git workflow

- Suggested branch: `advisor/011-auth-rate-limit-partitions`
- Suggested commit: `fix(auth): partition rate limits by client address`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extract testable policy registration

Create an internal static helper in `WebAPI/Extensions` that owns:

- stable constants for `login`, `register`, and `email`
- `ClientPartitionKey(HttpContext)` using normalized `RemoteIpAddress.ToString()` and a constant fallback such as `unknown-client`
- registration of each named policy with `RateLimitPartition.GetFixedWindowLimiter`

Use `options.AddPolicy(policyName, httpContext => ...)`, with the current permit/window/queue values. Keep `QueueProcessingOrder.OldestFirst` and `QueueLimit = 0`.

Update `Program.cs` to call the helper and retain `OnRejected`. Change the rejection text from the inaccurate fixed “wait 1 minute” to a policy-neutral “Please wait and try again.” Preserve status 429 and `application/json`.

**Verify**: build exits 0.

### Step 2: Add partition-key and option tests

In `AuthRateLimitPolicyTests.cs`, use `DefaultHttpContext` and fixed `IPAddress` values. Test:

- identical IPv4 addresses produce the same key
- different IPv4 addresses produce different keys
- identical/different IPv6 addresses behave equivalently
- absent remote address returns the documented fallback key
- login/register/email option factories retain their exact permit limits and windows

If the helper directly returns rate-limit partitions that are awkward to inspect, expose an internal pure policy descriptor `(PermitLimit, Window)` and key resolver, while keeping actual limiter construction in one place. Do not use reflection against framework internals.

**Verify**: focused tests exit 0.

### Step 3: Preserve endpoint bindings

Replace controller string literals with helper constants only if it improves typo safety without creating a layering violation. Confirm these existing bindings remain:

- register -> register policy
- login -> login policy
- forgot-password and resend-verification -> email policy

No authenticated user ID should be needed because login/register are anonymous.

**Verify**: search with `rg -n "EnableRateLimiting" src/BE/WebAPI/Controllers/AuthController.cs`; expected four attributes mapped as above.

### Step 4: Document proxy boundary in code

Add a concise comment at the key resolver: `RemoteIpAddress` is authoritative only after correctly configured trusted forwarded-header middleware. Do not enable `UseForwardedHeaders` with unrestricted proxies.

If the actual production environment is behind a reverse proxy and trusted proxy/network values are already available in repo configuration, stop and request a follow-up plan or operator values. Do not guess them.

**Verify**: full backend tests and build exit 0.

## Test plan

- Pure partition-key tests for IPv4, IPv6, distinct clients, same client, and null fallback.
- Pure policy descriptor tests for all three limits/windows.
- Full backend regression suite to ensure controller startup and DI registration still compile.
- Manual integration is optional: it must not send abusive traffic to any external service.

## Done criteria

- [ ] No auth policy uses `AddFixedWindowLimiter` without a partition key.
- [ ] Different remote IPs receive different partition keys.
- [ ] Existing permit limits/windows and endpoint policy mappings are preserved.
- [ ] Rejection message no longer falsely promises one minute for five-minute windows.
- [ ] No raw `X-Forwarded-For` parsing is introduced.
- [ ] Focused tests, full backend suite, and build exit 0.
- [ ] No files outside scope are modified.
- [ ] `plans/README.md` marks plan 011 DONE.

## STOP conditions

- The app is known to run behind a proxy but trusted proxy/network configuration is unavailable.
- Rate limits must be shared across multiple API instances; in-memory partitioning is insufficient and requires a distributed design.
- The framework API differs from the planned `AddPolicy`/`RateLimitPartition` shape after dependency changes.
- Fixing startup requires unrelated authentication refactors.

## Maintenance notes

- In-memory limits are per API process. Horizontal scaling needs a distributed limiter if globally consistent budgets are required.
- When deploying behind a proxy, configure trusted forwarded headers before relying on client IPs; never trust forwarding headers from arbitrary callers.
- A later security pass should separately decide whether refresh/reset/verify and AI-generation endpoints need their own policies.
