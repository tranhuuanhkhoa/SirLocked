# ADR — Paired Confrontation V3

- **Status:** Accepted — Gate 1 PASS
- **Date:** 2026-07-19
- **Decision owner:** Game Director / solo developer
- **Applies to:** `mechanicsVersion = 3` only

## Context

SirLocked V1/V2 stores canonical team progression and projects most unlocked content to both players. V3 tests a communication-first loop in which the Investigator owns physical evidence and the Interrogator owns testimony. The technical gate must prove caller-specific knowledge without changing the database platform, room/auth model, V1/V2 behavior, original cases or production data.

## 1. Mechanics version boundary

- Add `InvestigationV3PairedConfrontation = 3`.
- V1/V2 keep their current persistence, DTO and realtime behavior.
- V3 uses server-side caller projection. Client-side hiding is never an acceptable privacy boundary.
- No V3 case is published, migrated or made production-playable during this gate.

## 2. Knowledge lifecycle

Knowledge has three states:

1. `PRIVATE_KNOWLEDGE`: full content is visible only to its discovering player.
2. `ATTEMPT_DISCLOSED`: a complete evidence–testimony pair reached joint review and is visible to both forever.
3. `RESOLVED_SHARED_TRUTH`: a disclosed pair resolved correct and its reveal/unlocks are shared.

Every revision that reaches joint review creates an immutable disclosure. Editing cannot revoke a disclosure that a human has already seen. An incorrect result shares only its disclosed pair and safe failure feedback. Unrelated discoveries remain private.

## 3. Proposal lifecycle

Only the Interrogator starts an attempt by proposing a testimony fragment. Only the Investigator proposes evidence. A room has at most one active attempt. Each role may replace only its own proposal. A no-op replacement is idempotent; a changed proposal increments revision and clears confirmations.

## 4. Review and confirmation semantics

State machine:

```text
NONE
→ CollectingProposals
→ ReadyForReview
→ AwaitingSecondConfirmation
→ ResolvedCorrect | ResolvedIncorrect
```

Both proposals remain role-private while collecting. When both exist, the exact pair is disclosed to both players and the state becomes `ReadyForReview`. A confirmation is valid only for the active revision. The first confirmation moves to `AwaitingSecondConfirmation`; the second resolves in the same optimistic room write. Duplicate confirmation is unchanged. A retry after resolution returns the stored terminal attempt.

## 5. Wrong-attempt visibility

- The exact reviewed pair and safe failure response remain in shared attempt history.
- Failure feedback explains why the relation is insufficient but never returns correct IDs, names or direct answer hints.
- Only correct attempts appear in `ResolvedSharedTruth` and unlock downstream content.
- Cancelled attempts provide no correctness feedback. Any revision already disclosed before cancellation remains shared.

## 6. Photo authorization

For V3, `CanViewEvidencePhoto(room, userId, clueId)` is true only when the caller discovered the clue or the clue is part of a disclosed pair. A private-but-existing photo and a nonexistent photo return the same `EVIDENCE_NOT_AVAILABLE` error. V1/V2 retain legacy visibility.

## 7. Action-log audience

V3 does not project the existing shared action log. During Gate 1, private V3 actions do not persist semantic IDs, titles or content into `GameActionLog`. This is an intentional MVP boundary; no generic ACL system is introduced. V1/V2 logs are unchanged.

## 8. SignalR audience

V3 broadcasts only:

```json
{ "roomId": "...", "version": 12 }
```

The hub never receives a full `GameStateResponse`. Clue, item, dialogue, fragment, challenge, evidence and photo IDs are not sent to the room group for V3. Each client refetches caller-specific state after version invalidation.

## 9. Error-message secrecy

V3 failures use a generic message plus stable `errors.code` and `errors.messageKey`. Existence, title, owner, correct-answer IDs, locked secret IDs and exception details are never returned. Required initial codes:

| Code | HTTP | Message key |
|---|---:|---|
| `EVIDENCE_NOT_AVAILABLE` | 404 | `game.confrontation.evidenceUnavailable` |
| `CONFRONTATION_STALE` | 409 | `game.confrontation.stale` |
| `CONFRONTATION_NOT_AVAILABLE` | 409 | `game.confrontation.notAvailable` |
| `ACTION_BLOCKED_BY_CONFRONTATION` | 409 | `game.confrontation.actionBlocked` |

## 10. Scene, disconnect and abandon behavior

- While an attempt is active, notebook/read, own-proposal edit, confirm and cancel remain available.
- Scene/stage completion, scene transition, accusation and unilateral `present-evidence` are blocked.
- Disconnect does not mutate the attempt or confirmations. Reconnect refetches authoritative state.
- Either player may cancel without penalty.
- Room abandon stores the active attempt as `Cancelled` in the abandoned snapshot; it cannot resume into a new match.
- Invalid proposal content is never replaced silently. The server reports `CONFRONTATION_STALE`; the owning role must reselect or either player may cancel.

## 11. Idempotency and revision

- Attempt ID is stable across retries.
- Same proposal at the current revision is unchanged.
- Changed proposal increments revision and clears all confirmations.
- Confirmation record contains `UserId`, `Role`, `Revision`, `ConfirmedAt`.
- Optimistic room version protects persistence. A losing concurrent write reloads authoritative state.
- Correct unlock and incorrect-attempt count occur at most once.

## 12. MVP non-goals

- No paired mutation API, frontend UI or playable V3 sandbox before the seven-day privacy gate passes.
- No conversation-tree transcript support in the first V3 slice; use flat dialogue plus testimony fragments.
- No multiple active attempts, Investigator initiation, theory graph, voice chat, timer, cinematic, AI V3 generator or production case migration.
- `Flag as suspicious` remains an extension point only.
- No MongoDB Atlas or production database access. Later integration tests must use an isolated local database.

## Caller projection matrix

| Surface | Collecting | Ready/Awaiting | Incorrect | Correct |
|---|---|---|---|---|
| Own proposal | Full | Full | In disclosed history | In resolved truth |
| Partner proposal | Readiness only | Full disclosed pair | Full disclosed pair | Full resolved pair |
| Unrelated private discoveries | Owner only | Owner only | Owner only | Owner only |
| Photo | Owner only | Disclosed evidence visible | Disclosed evidence visible | Visible |
| Action log | Empty | Empty | Empty | Empty |
| SignalR | Version only | Version only | Version only | Version only |
| Failure/success response | None | None | Safe failure only | Success and reveal |

## Gate decision

Pass only when the same canonical V3 state produces different serialized caller responses, neither wrong-role response contains private sentinels, all tested secondary channels are clean and every pre-existing V1/V2 test passes. If privacy requires frontend hiding or a room/auth rewrite, the direction is `NO-GO`.
