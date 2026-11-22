# Local load tests

Requires k6 and a throwaway API/database. These scripts refuse remote `BASE_URL`
values unless `ALLOW_REMOTE=1`; never use production data. The API must be in
Development with `Auth__AutoVerifyRegistrations=true` and
`CaseCatalog__PixelOnly=false`. Keep ports 5215/5173 and the shared
`sirlocked-mongo` database untouched.

For HTTP smoke/load/stress runs, start the throwaway API with
`RateLimiting__Login__PermitLimit=100000` and
`RateLimiting__Register__PermitLimit=100000`. The defaults remain 5 logins per
60 seconds and 3 registrations per 300 seconds, with zero queue. The separate
`auth` scenario must run against those defaults and performs four logins per
minute with one VU. Do not raise auth limits in production.

Each VU registers once during k6 setup (or logs in if its deterministic
`loadtest+<vu>@sirlocked.test` account already exists), then reuses its access
token; refresh is used only if a run exceeds the 60-minute token lifetime.
The HTTP read mix does not log in per iteration. SignalR VUs are paired: they
create/join a public room through REST, ready/start it, connect to `/hubs/game`,
and measure `inspect-item` command-to-`GameStateUpdated` latency.

```sh
mkdir -p /home/ubuntu/reports/loadtest/results
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=smoke scripts/loadtest/http-api.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=load -e VUS=50 scripts/loadtest/http-api.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=stress -e MAX_VUS=200 scripts/loadtest/http-api.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=auth scripts/loadtest/http-api.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=smoke scripts/loadtest/signalr-game.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=load -e VUS=50 scripts/loadtest/signalr-game.js
k6 run -e BASE_URL=http://127.0.0.1:5515 -e SCENARIO=stress -e MAX_VUS=200 scripts/loadtest/signalr-game.js
```

Smoke is 1 HTTP VU or one SignalR pair for 30 seconds; load is 50 VUs for five
minutes; stress ramps to 200 VUs. Thresholds are API p95 below 500 ms, HTTP
failures below 1%, and SignalR command-to-broadcast p95 below 1,000 ms. Each
run writes full JSON and a compact text summary under
`/home/ubuntu/reports/loadtest/results` (override with `RESULTS_DIR`).
