# V3 Sandbox Build A — Freeze Memo

## Freeze identity

- Runtime/code commit: `1cc48f7f68c603cb67ecc057f91313cc475f78bd`
- Freeze documentation: commit containing this memo; it does not change runtime code.
- English fixture SHA-256: `234029B2426342323F0C20D4D02F26CBECE3EDBAEE16DED193BE45BF10C33A9D`
- Vietnamese fixture SHA-256: `AE1497C8169AF3517C4D0393BED47A54CDE54A263820C1DE6082DDA249456072`
- Feature flag: `GameplayV3.Enabled=true` only in isolated V3 local config.
- Instrumentation: default no-op; local config writes only privacy-safe typed events.

## Frozen scope

Build A contains one evidence–testimony loop, one active confrontation per room, revision-bound dual confirmation, wrong retry, correct Crack payoff and one downstream reveal. It contains no accusation, conversation tree, new art, audio framework, migrated production case or V3 AI generator.

Do not edit runtime code, fixture JSON, copy, hint behavior or CSS between Human Gate 1 sessions. Any change creates Build B with a new commit and fixture checksum.

## Verification snapshot

| Check | Result |
|---|---|
| Backend Debug unit suite | 276 passed |
| Backend Release build | Passed, 0 warnings / 0 errors |
| Integration harness default run | 1 passed (harness compile/guard only; real Mongo opt-in was not enabled) |
| Full frontend browser suite | 16 passed, including three consecutive two-context V3 runs |
| Opt-in real full-stack browser gate | Implemented for three serial rooms; not executed because Docker is unavailable |
| Frontend typecheck | Passed |
| Frontend production build | Passed; existing bundle-size warning remains non-blocking |
| Real Mongo local integration | Not executed: Docker/mongod unavailable on this workstation |
| Mongo Atlas / production DB | Not accessed |

The three-run browser result above is a shared mocked API/state contract test, not evidence of real Mongo concurrency. A separate opt-in test performs login, room lifecycle, private discovery, wrong/edit/reload/correct flow and privacy assertions through real HTTP/Auth/Mongo on three serial rooms. Build A is not eligible for a human session requiring real persistence until both local gates run green.

## Start and export

1. Install Docker Desktop or a local MongoDB compatible with the isolated compose; never point the config at Atlas.
2. Run `scripts/run-v3-local.ps1` from the repository root. Credentials/JWT material exist only in the process environment.
3. Run `scripts/test-v3-local-mongo.ps1`; require a green real-Mongo gate before Human Gate 1.
4. Run `scripts/test-v3-local-full-stack.ps1`; require three consecutive real full-stack browser passes.
5. Export typed events with `scripts/export-v3-playtest.ps1`. The script refuses SRV, remote hosts and database names outside `sirlocked_v3_*`.

## Evidence boundary

Automation may establish flow, idempotency, projection privacy, DOM privacy and deterministic state transitions. Whether the loop is fun, tense, surprising, memorable or worth replaying is **Requires human playtest validation**.
