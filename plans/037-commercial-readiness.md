# Plan 037 — SirLocked commercial readiness

Approved objective: international browser game, self-service AI story + fresh images, one buyer invites one free partner, USD 10,000 received before income tax and valuation of developer labor. Capacity: one developer, 10–15 hours/week, initial cash ceiling USD 500. Proposed test price: USD 19.99 per successfully delivered case; not a measured willingness-to-pay result.

## Delivery gates

| Gate | Required evidence | Current state |
|---|---|---|
| A / initial | Three new pairs, frozen build, observations + interviews + persistent telemetry | TOOLING IMPLEMENTED; HUMAN NOT RUN |
| A / follow-up | 8–12 pairs with comprehension/communication/waiting targets, no blocking errors in final round, >=70% want another case | NOT RUN |
| B | Twenty SHORT_DEMO English two-scene cases including new images; >=18 ready without manual fixes; mean all-attempt AI cost per delivered case <=USD 6; generation P95 <=30 minutes | NOT RUN; depends on A |
| C | Payment provider approval, private customer generation workflow, spoiler-safe API, idempotent purchase/job ledger, asset authorization, restore/recovery evidence | NOT STARTED; depends on B |
| D | Ten external paying buyers then fifty orders; >=95% automatic delivery; <=5% refunds; <=15 minutes support/order; >=USD 9 after variable costs/order | NOT RUN; depends on C |
| E | Attributed demo/purchase/repeat purchase results; reinvest only received cash; USD 10,000 actually received after costs | NOT RUN; depends on D |

Tooling does not change human gate status. Automated fixtures are not participants. Keep plan014 open until its real evidence exists. Do not infer customer enjoyment from automated completions, or cost of fresh images from the September text-only trial.

## Stage A execution

Use `scripts/playtest-kit.py` and [remote playtest runbook](../docs/PLAYTEST_REMOTE_KIT_VI.md). Protocol remains the source for facilitator behavior and comprehension rubric. Preserve old CSV sample rows; use batch-specific evidence files. Freeze includes actual working tree hashes because the current checkout contains uncommitted work. A locale-specific case checksum and a combined batch checksum avoid pretending English/Vietnamese files have identical bytes.

After the initial gate, record no more than five changes tied to observations. Keep old batches and never mix builds in one reported round. Select new participants who have not seen the answers; follow-up must include enough English-speaking players to assess the international product.

Technical verification on 2026-10-03: API and seeder Release publishes, packaged frontend build, frontend typecheck and four asset-packaging checks passed. The 64 focused backend regressions, two real Mongo telemetry integration tests (zero skipped), ten evidence-gate unit tests and two gateway tests passed. A two-browser preflight passed all nine checks locally and through the temporary HTTPS tunnel, including role privacy, outsider denial, SignalR and reconnect. Stop/start reused the dedicated database and original frozen cases/accounts. Logs and TRX evidence are under `tmp/commercial-readiness/` and `tmp/playtest/commercial-r1-20261003-live/logs/`. Frozen bundle: `67a5f0989be32da71e71ba958e0516bffa0501db1baedc21b0d16e046cc059d8`. The empty human report correctly remains NOT RUN; technical probe rooms are excluded from human capture windows.

## Stage B measurement contract

Use the same preset, difficulty and stage count for all twenty jobs. Log job/build IDs, start/end UTC, final review/validation/asset state, manual intervention minutes, every failed/retry provider call, reconciled USD and delivered state. Include unsuccessful jobs in the cost numerator; divide by delivered cases. Unreconciled/reserved/unknown calls block financial PASS. Compute nearest-rank P95 across successful jobs and report failure/timeout durations separately. Automatic repairs: at most one per stage, within the job budget. Unknown provider outcomes never authorize blind resubmission.

Total measurement allocation: USD 180. Verify current text/image prices before spending; keep existing usage ledger and reservations, never reset prior expenditure. Do not expand the budget to force PASS. No AI video in v1.

## Stage C behavior contract

Keep admin tools private. Add customer-only order/checkout/job/progress interfaces; never give PLAYER buyers VIP/admin privileges or return truth, answers, full JSON or spoiler reports. Inputs: fictional manor/museum/train setting, fixed difficulty. Only deliver validated/reviewed assets and gameplay. Add GenerationOrder linked to one payment and one job, idempotent webhook/job admission and owner-private cases. One active room/case, buyer replay and one free invited partner; member checks apply to all media.

Start with Lemon Squeezy only after product/store/payout approval; payment denial blocks opening sales. Failed delivery after 24 hours refunds the order and closes further generation rights. Before launch, verify signed/replayed webhooks, payment races, refund revocation, job restart, unknown provider status, cross-account access and spoiler privacy. Use separate staging, HTTPS, backup + restore rehearsal and monitored single-instance API.

## Money and acquisition

| Allocation | USD ceiling |
|---|---:|
| AI measurement | 180 |
| Hosting/domain | 120 |
| Playtest support | 50 |
| Marketing materials | 50 |
| Contingency | 100 |
| Total initial cash | 500 |

Planning contribution/order: 19.99 − 2.10 payment/payout allowance − 6 AI including failed attempts − 1 hosting/email/storage − 1 refund contingency = USD 9.89. At 1,100 orders this leaves USD 10,379 after another USD 500 initial cash; update from actual fees, refunds, provider bills and cash received. This is arithmetic, not a sales forecast. Avoid counting initial cash a second time when replacing variable allowances with actual ledger costs.

Before paid advertising: fixed free demo, English sales page, 45–60 second real gameplay trailer, two gameplay clips/week and introductions only in communities that permit promotion. No automated messaging to people. Measure source -> demo -> completion -> purchase -> second purchase; spend more only on channels with measured positive contribution.

## Exclusions and next checkpoint

Steam, mobile, AI video, subscriptions and marketplace remain outside v1. Next checkpoint: three real-pair evidence bundles and a human decision. The proposed 150–250 hours to paid pilot remains low-confidence until throughput is measured; do not promise a USD 10,000 achievement date.
