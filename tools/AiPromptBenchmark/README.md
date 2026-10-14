# AI case benchmark

Run the deterministic regression benchmark without provider calls:

```powershell
dotnet run --project tools/AiPromptBenchmark -- --mode mock --output analysis/ai-case-benchmark.json
```

The mock report measures UTF-8 bytes and compiler/validator equivalence. It must not be interpreted as provider token or cost data.

For a live run, use an isolated API/DB instance and an admin bearer token. The runner never imports or publishes a case and enforces a maximum of five USD for the whole run:

```powershell
$env:SIRLOCKED_BENCHMARK_BASE_URL = 'http://127.0.0.1:5215'
$env:SIRLOCKED_BENCHMARK_TOKEN = '<admin-token>'
$env:SIRLOCKED_BENCHMARK_RESERVATION_USD = '0.25'
dotnet run --project tools/AiPromptBenchmark -- --mode live --max-usd 5 --reserve-usd 0.25 --output analysis/ai-case-benchmark-live.json
```

The reservation must be a conservative per-call amount already configured in the isolated API. If it is unknown, the command writes a `BLOCKED` report without making a provider request. The runner only evaluates gameplay text: it does not call image/video routes, import, or publish. `--mode resume --state <report.json>` resumes only samples marked incomplete in the saved report and carries forward known cost plus pending reservations.
