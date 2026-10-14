#!/usr/bin/env python3
"""Freeze, serve and collect real V3 playtest evidence. No AI/payment calls."""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parent.parent
ROLES = ("INVESTIGATOR", "INTERROGATOR")
OBSERVATION_FIELDS = "session_id build_commit sandbox_locale sandbox_checksum elapsed_seconds investigator_action investigator_actionable interrogator_action interrogator_actionable communication_state private_detail_spoken_before_review joint_review_revision waiting_role waiting_episode_seconds wrong_pair_count edit_count clarification_count facilitator_intervention intervention_category technical_error observer_notes_no_pii".split()
SURVEY_FIELDS = "session_id role has_seen_answer completed_case comprehension_score wants_next_case blocking_errors cooperation_example_no_pii waiting_feedback_no_pii reason_no_pii".split()
SECRET_KEYS = ("OpenAI__ApiKey", "OPENAI_API_KEY", "AI__ChatGptApiKey", "Cloudinary__ApiKey", "Cloudinary__ApiSecret", "PresentationVideo__ApiKey", "Google__ClientId", "Google__ClientSecret")

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))

def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def write_csv(path, fields, rows):
    with Path(path).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

def bundle_files(root):
    return {p.relative_to(root).as_posix(): digest(p)
            for name in ("api", "frontend", "seeder", "cases", "runtime")
            for p in sorted((root / name).rglob("*")) if p.is_file()}

def verify(root):
    manifest = read_json(root / "manifest.json")
    actual = bundle_files(root)
    if actual != manifest["files"]:
        changed = sorted(set(actual) ^ set(manifest["files"]) | {p for p in actual if p in manifest["files"] and actual[p] != manifest["files"][p]})
        raise ValueError("Frozen bundle changed: " + ", ".join(changed[:8]))
    fingerprint = hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest()
    if fingerprint != manifest["bundleHash"]:
        raise ValueError("Manifest fingerprint changed.")
    return manifest

def build(command, cwd):
    subprocess.run(command, cwd=cwd, check=True)

def prepare(args):
    if not re.fullmatch(r"[a-z0-9_-]{1,48}", args.batch):
        raise ValueError("Batch must be 1-48 lowercase letters, digits, underscores or hyphens.")
    root = REPO / "tmp" / "playtest" / args.batch
    if root.exists():
        raise ValueError("Batch already exists; create a new batch instead of overwriting evidence.")
    for folder in ("api", "frontend", "seeder", "cases", "runtime", "private", "evidence", "logs", "mongo-data"):
        (root / folder).mkdir(parents=True)
    # This sentinel prevents EnvFileLoader walking up to the user's real .env.
    (root / ".env").write_text("# Isolated frozen playtest; never load parent secrets.\n", encoding="utf-8")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    candidates = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src/BE", "src/FE", "tools/PlaytestSeeder", "scripts/playtest-kit.py", "scripts/playtest-gateway.mjs"], cwd=REPO).decode().split("\0")
    source = {}
    for relative in sorted(set(candidates)):
        p = REPO / relative
        if not relative or not p.is_file() or any(x in p.parts for x in ("bin", "obj", "GeneratedCaseJson", "ai-generated", "test-results", "node_modules", "dist")):
            continue
        if p.name.startswith(".env") or (p.name.startswith("appsettings.") and p.name != "appsettings.json"):
            continue
        source[relative] = digest(p)
    fixtures = []
    selected_cases = [REPO / f"src/BE/SeedData/V3/case-v3-broken-seal-{locale}.json" for locale in ("en", "vi")]
    selected_cases += [p.resolve() for p in args.case]
    case_ids = set()
    for original in selected_cases:
        relative = original.relative_to(REPO).as_posix()
        document = read_json(original)
        case_id = document["caseId"]
        if case_id in case_ids:
            raise ValueError("Duplicate selected case: " + case_id)
        case_ids.add(case_id)
        source[relative] = digest(original)
        locale = document.get("language", "en")
        target = root / "cases" / original.name
        if target.exists():
            target = root / "cases" / (str(len(fixtures)) + "-" + original.name)
        shutil.copyfile(original, target)
        fixtures.append({"locale": locale, "caseId": case_id, "path": target.relative_to(root).as_posix(), "sha256": digest(target)})
    build(["dotnet", "publish", "src/BE/SirLocked.Api.csproj", "--no-restore", "-c", "Release", "-o", str(root / "api")], REPO)
    build(["dotnet", "publish", "tools/PlaytestSeeder/PlaytestSeeder.csproj", "-c", "Release", "-o", str(root / "seeder")], REPO)
    case_arguments = [argument for fixture in fixtures for argument in ("--case", str(root / fixture["path"]))]
    build(["node", "scripts/build-cases.mjs", *case_arguments, "--out-dir", str(root / "frontend")], REPO / "src/FE")
    # SDK publish can copy ignored local settings. Ship only sanitized settings.
    for folder in ("api", "seeder"):
        for settings in (root / folder).glob("appsettings*.json"):
            write_json(settings, {"Logging": {"LogLevel": {"Default": "Warning", "Microsoft.AspNetCore": "Warning"}}})
        for env_file in (root / folder).glob(".env*"):
            env_file.unlink()
    shutil.copyfile(REPO / "scripts/playtest-gateway.mjs", root / "runtime/playtest-gateway.mjs")
    shutil.copyfile(REPO / "scripts/playtest-kit.py", root / "runtime/launcher-source.py")
    # A source edit during the build must invalidate this freeze.
    if any(not (REPO / p).is_file() or digest(REPO / p) != value for p, value in source.items()):
        raise ValueError("Sources changed while building. Prepare a fresh batch.")
    combined = hashlib.sha256(json.dumps(fixtures, sort_keys=True).encode()).hexdigest()
    sessions = [{"id": f"A{i:02}", "locale": locale, "caseId": f"case-v3-broken-seal-{locale}"}
                for i, locale in enumerate(("vi", "vi", "en"), 1)]
    files = bundle_files(root)
    manifest = {"version": 1, "batch": args.batch, "createdUtc": now(), "buildCommit": commit,
                "sourceFiles": source, "sourceHash": hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest(),
                "bundleHash": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
                "sandboxChecksum": combined, "database": f"SirLockedPlaytest_{args.batch}",
                "cases": fixtures, "sessions": sessions, "files": files,
                "humanGate": "NOT RUN", "paidAiGate": "NOT RUN", "checkoutEnabled": False,
                "thresholds": {"wantsNextPct": 70, "minimumScalePairs": 8, "comprehension": 4,
                               "waitingImbalancePct": 15, "maximumInterventions": 1, "minimumSharingIntervals": 2}}
    write_json(root / "manifest.json", manifest)
    accounts = [{"name": "Playtest facilitator", "email": "facilitator@playtest.invalid", "password": secrets.token_urlsafe(24), "role": "ADMIN"}]
    for session in sessions:
        for role in ROLES:
            accounts.append({"name": f"{session['id']} {role}", "email": f"{session['id'].lower()}-{role.lower()}@playtest.invalid", "password": secrets.token_urlsafe(24), "role": "PLAYER"})
    credentials = {"accessPassword": secrets.token_urlsafe(24), "cookieSecret": secrets.token_hex(32),
                   "jwtSecret": secrets.token_hex(48), "pseudonymKey": secrets.token_hex(32), "accounts": accounts}
    write_json(root / "private/credentials.json", credentials)
    for session in sessions:
        folder = root / "evidence" / session["id"]
        folder.mkdir()
        rows = [{"session_id": session["id"], "build_commit": commit, "sandbox_locale": session["locale"],
                 "sandbox_checksum": combined, "elapsed_seconds": t} for t in range(0, 2101, 30)]
        write_csv(folder / "observations.csv", OBSERVATION_FIELDS, rows)
        write_csv(folder / "survey.csv", SURVEY_FIELDS, [{"session_id": session["id"], "role": role} for role in ROLES])
    (root / "private/player-invitations.txt").write_text("PRIVATE: share only each player's own account.\nAccess password: " + credentials["accessPassword"] + "\n\n" + "\n".join(f"{a['name']}\nEmail: {a['email']}\nPassword: {a['password']}\n" for a in accounts if a["role"] == "PLAYER"), encoding="utf-8")
    print(f"Frozen bundle: {root}\nBundle SHA256: {manifest['bundleHash']}\nHuman gate: NOT RUN. Credentials saved privately; never print or commit them.")

def free_port(port):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))

def spawn(root, name, command, env=None, cwd=None):
    with (root / "logs" / f"{name}.log").open("ab") as log:
        child = subprocess.Popen(command, cwd=cwd or root, env=env, stdout=log, stderr=log,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return {"name": name, "pid": child.pid, "created": process_identity(child.pid)}

def process_identity(pid):
    if os.name != "nt":
        return Path(f"/proc/{pid}/stat").read_text().split()[21]
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ProcessLookupError("Process not available")
    try:
        values = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(x) for x in values)):
            raise ProcessLookupError("Process creation time unavailable")
        return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
    finally:
        kernel.CloseHandle(handle)

def wait_ready(probe, entries, seconds=45):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        for entry in entries:
            if process_identity(entry["pid"]) != entry["created"]:
                raise RuntimeError(entry["name"] + " exited; see batch logs.")
        try:
            if probe():
                return
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    raise TimeoutError("Service did not become ready; see batch logs.")

def http_json(url, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)

def start(args):
    root = args.run.resolve()
    manifest = verify(root)
    if (root / "processes.json").exists():
        raise ValueError("Batch already has process state. Stop it before restarting.")
    for port in (args.mongo_port, args.api_port, args.gateway_port):
        free_port(port)
    if len({args.mongo_port, args.api_port, args.gateway_port}) != 3:
        raise ValueError("Ports must be different.")
    mongod = args.mongod or shutil.which("mongod")
    if not mongod:
        matches = sorted((REPO / ".tools").rglob("mongod.exe"))
        mongod = str(matches[-1]) if matches else None
    if not mongod:
        raise ValueError("Pass --mongod with a local MongoDB executable.")
    cloudflared = args.cloudflared or shutil.which("cloudflared")
    if args.tunnel and not cloudflared:
        raise ValueError("Pass --cloudflared with the verified executable.")
    credentials = read_json(root / "private/credentials.json")
    entries = []
    state = {"processes": entries, "apiUrl": f"http://127.0.0.1:{args.api_port}", "gatewayUrl": f"http://127.0.0.1:{args.gateway_port}", "publicUrl": None, "bundleHash": manifest["bundleHash"]}
    def save():
        write_json(root / "processes.json", state)
    try:
        entries.append(spawn(root, "mongo", [str(mongod), "--bind_ip", "127.0.0.1", "--port", str(args.mongo_port), "--dbpath", str(root / "mongo-data")]))
        save()
        def mongo_ready():
            with socket.create_connection(("127.0.0.1", args.mongo_port), timeout=.5):
                return True
        wait_ready(mongo_ready, entries)
        environment = os.environ.copy()
        # Remove inherited providers/SMTP as well as repo-local config; only explicit local settings apply.
        for key in list(environment):
            if key.startswith(("OpenAI__", "Cloudinary__", "PresentationVideo__", "Email__", "AiUsage__", "AiQuota__", "Google__", "Auth__", "MongoDb__", "Cors__", "Jwt__", "Playtest__")) or key in SECRET_KEYS:
                del environment[key]
        environment.update({"SIRLOCKED_PLAYTEST_MONGO": f"mongodb://127.0.0.1:{args.mongo_port}/?serverSelectionTimeoutMS=5000", "SIRLOCKED_PLAYTEST_DATABASE": manifest["database"]})
        subprocess.run(["dotnet", str(root / "seeder/PlaytestSeeder.dll"), str(root)], cwd=root, env=environment, check=True)
        environment.update({
            "ASPNETCORE_ENVIRONMENT": "Development", "MongoDb__ConnectionString": environment["SIRLOCKED_PLAYTEST_MONGO"],
            "MongoDb__DatabaseName": manifest["database"], "MongoDb__AllowDegradedStartup": "false",
            "Jwt__Secret": credentials["jwtSecret"], "Jwt__Issuer": "SirLockedPlaytest", "Jwt__Audience": "SirLockedPlaytest",
            "Playtest__PseudonymKey": credentials["pseudonymKey"], "Playtest__RetentionDays": "30",
            "GameplayV3__Enabled": "true", "GameplayV3__PlaytestInstrumentationEnabled": "true",
            "Auth__SeedDefaultAdmin": "false", "Auth__AutoVerifyRegistrations": "false",
            "Email__FrontendUrl": state["gatewayUrl"], "Cors__AllowedOrigins__0": state["gatewayUrl"],
            "TrustedProxies__0": "127.0.0.1",
            "OpenAI__ApiKey": "", "OpenAI__AiDryRun": "true", "OpenAI__MockAiResponses": "true",
            "OpenAI__SkipAssetGeneration": "true", "OpenAI__DisableAutoPublish": "true",
            "AI_DRY_RUN": "true", "MOCK_AI_RESPONSES": "true", "SKIP_ASSET_GENERATION": "true",
            "DISABLE_AUTO_PUBLISH": "true", "AiQuota__Enabled": "true", "AiQuota__GlobalBudgetUsd": "0",
            "PresentationVideo__Enabled": "false", "Cloudinary__Enabled": "false", "Swagger__Enabled": "false"})
        # The existing app registers Google authentication even when unused; syntactically
        # non-empty dummy credentials satisfy its options validation without any real key.
        environment.update({"Google__ClientId": "playtest-disabled", "Google__ClientSecret": "playtest-disabled"})
        entries.append(spawn(root, "api", ["dotnet", str(root / "api/SirLocked.Api.dll"), "--urls", state["apiUrl"]], environment, root / "api"))
        save()
        def healthy():
            with urllib.request.urlopen(state["apiUrl"] + "/health", timeout=2) as response:
                return response.status == 200 and response.read().strip() == b"Healthy"
        wait_ready(healthy, entries)
        admin = next(a for a in credentials["accounts"] if a["role"] == "ADMIN")
        token = http_json(state["apiUrl"] + "/api/auth/login", "POST", {"email": admin["email"], "password": admin["password"]})["data"]["token"]
        http_json(state["apiUrl"] + "/api/admin/playtest/summary", token=token)
        gateway_config = root / "private/gateway.json"
        write_json(gateway_config, {"root": str(root / "frontend"), "apiPort": args.api_port, "port": args.gateway_port,
                                   "secret": credentials["cookieSecret"], "accessPassword": credentials["accessPassword"]})
        entries.append(spawn(root, "gateway", ["node", str(root / "runtime/playtest-gateway.mjs"), str(gateway_config)]))
        save()
        def gateway_ready():
            with urllib.request.urlopen(state["gatewayUrl"] + "/playtest/access", timeout=2) as response:
                return response.status == 200
        wait_ready(gateway_ready, entries)
        if args.tunnel:
            tunnel_config = root / "private/cloudflared.yml"
            tunnel_config.write_text("{}\n", encoding="utf-8")
            entries.append(spawn(root, "tunnel", [str(cloudflared), "tunnel", "--config", str(tunnel_config),
                "--no-autoupdate", "--url", state["gatewayUrl"], "--protocol", "http2"]))
            save()
            def tunnel_ready():
                match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", (root / "logs/tunnel.log").read_text(encoding="utf-8", errors="replace"))
                if match:
                    state["publicUrl"] = match.group(0)
                    return True
                return False
            wait_ready(tunnel_ready, entries, seconds=60)
            save()
            with (root / "private/player-invitations.txt").open("a", encoding="utf-8") as handle:
                handle.write("\nCurrent temporary URL: " + state["publicUrl"] + "\n")
        print("Playtest ready: " + (state["publicUrl"] or state["gatewayUrl"]))
        print("Share each player's own entry from private/player-invitations.txt. Run pairs sequentially; real human gate remains NOT RUN.")
    except Exception:
        stop_entries(entries)
        (root / "processes.json").unlink(missing_ok=True)
        raise

def stop_entries(entries):
    for entry in reversed(entries):
        try:
            if process_identity(entry["pid"]) != entry["created"]:
                continue
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
                kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                handle = kernel.OpenProcess(1, False, entry["pid"])
                if handle:
                    try:
                        kernel.TerminateProcess(handle, 0)
                    finally:
                        kernel.CloseHandle(handle)
            else:
                import signal
                os.kill(entry["pid"], signal.SIGTERM)
        except (OSError, ProcessLookupError):
            continue

def stop(args):
    path = args.run.resolve() / "processes.json"
    if not path.exists():
        print("No managed playtest is running.")
        return
    stop_entries(read_json(path)["processes"])
    path.unlink()
    print("Stopped only owned playtest processes. Evidence and database retained.")

def capture(args):
    root = args.run.resolve()
    manifest = verify(root)
    if args.session not in [s["id"] for s in manifest["sessions"]]:
        raise ValueError("Unknown session.")
    start_time = dt.datetime.fromisoformat(args.from_utc.replace("Z", "+00:00"))
    end_time = dt.datetime.fromisoformat(args.to_utc.replace("Z", "+00:00"))
    if start_time.tzinfo is None or end_time.tzinfo is None or not start_time < end_time or (end_time-start_time).total_seconds() > 5400:
        raise ValueError("Use explicit UTC offsets and a session window no longer than 90 minutes.")
    state = read_json(root / "processes.json")
    admin = next(a for a in read_json(root / "private/credentials.json")["accounts"] if a["role"] == "ADMIN")
    token = http_json(state["apiUrl"] + "/api/auth/login", "POST", {"email": admin["email"], "password": admin["password"]})["data"]["token"]
    query = urllib.parse.urlencode({"from": args.from_utc, "to": args.to_utc})
    summary = http_json(state["apiUrl"] + "/api/admin/playtest/summary?" + query, token=token)["data"]
    if summary["eventCount"] <= 0 or summary["sessionCount"] != 1 or summary["isTruncated"]:
        raise ValueError("Expected exactly one non-empty, non-truncated room. Run pairs sequentially and use precise session windows.")
    output = root / "evidence" / args.session / "telemetry.json"
    if output.exists():
        raise ValueError("Telemetry already captured. Preserve prior evidence instead of overwriting it.")
    write_json(output, {"sessionId": args.session, "bundleHash": manifest["bundleHash"], "capturedUtc": now(), "summary": summary})
    print(f"Captured privacy-safe telemetry: {output}")

def report(args):
    root = args.run.resolve()
    manifest = verify(root)
    results = []
    for session in manifest["sessions"]:
        folder = root / "evidence" / session["id"]
        with (folder / "observations.csv").open(encoding="utf-8-sig", newline="") as handle:
            observations = list(csv.DictReader(handle))
        with (folder / "survey.csv").open(encoding="utf-8-sig", newline="") as handle:
            surveys = list(csv.DictReader(handle))
        results.append(assess_session(manifest, session, observations, surveys,
                                     read_json(folder / "telemetry.json") if (folder / "telemetry.json").exists() else None))
    status = "NOT RUN" if all(r["status"] == "NOT RUN" for r in results) else "INCOMPLETE"
    if all(r["status"] in ("PASS", "FAIL") for r in results):
        status = "PROCEED TO FOLLOW-UP PLAYTEST" if all(r["status"] == "PASS" for r in results) else "ITERATE"
        if sum(r["wantsNextPct"] for r in results)/len(results) < 70:
            status = "ITERATE"
        scores = [r["comprehension"] for r in results]
        if sum(r["completed"] for r in results) == 0 or sum(scores)/len(scores) < 2.5:
            status = "KILL / REDESIGN CORE LOOP"
    value = {"generatedUtc": now(), "bundleHash": manifest["bundleHash"], "humanGate": status,
             "scalePermitted": False, "paidAiGate": "NOT RUN", "checkoutEnabled": False, "sessions": results}
    write_json(root / "evidence/gate-report.json", value)
    lines = [f"# Playtest gate: {status}", "", f"Frozen bundle: `{manifest['bundleHash']}`", "",
             "Three pairs cannot establish scale readiness. This report does not unlock AI spending or checkout.", "",
             "| Pair | Status | Evidence gaps / outcome |", "|---|---|---|"]
    lines += [f"| {r['sessionId']} | {r['status']} | {'; '.join(r['reasons']) or 'Initial thresholds met'} |" for r in results]
    (root / "evidence/gate-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Human gate: {status}. Paid AI gate: NOT RUN. Checkout: disabled.\nReport: {root / 'evidence/gate-report.md'}")

def assess_session(manifest, session, observations, surveys, telemetry):
    result = {"sessionId": session["id"], "status": "NOT RUN", "reasons": []}
    observed = [r for r in observations if any(r.get(k, "") for k in OBSERVATION_FIELDS[5:])]
    if not observed and not any(s.get("comprehension_score") for s in surveys) and telemetry is None:
        result["reasons"] = ["No real observations, interviews or telemetry captured"]
        return result
    missing = []
    if not observed:
        missing.append("Missing observations")
    for r in observed:
        if (r.get("session_id"), r.get("build_commit"), r.get("sandbox_locale"), r.get("sandbox_checksum")) != (session["id"], manifest["buildCommit"], session["locale"], manifest["sandboxChecksum"]):
            missing.append("Observation build/case provenance mismatch")
            break
    try:
        ticks = [int(r["elapsed_seconds"]) for r in observed]
        if ticks != list(range(0, ticks[-1] + 1, 30)):
            missing.append("Observation timeline has missing/duplicate intervals")
        for r in observed:
            if r.get("investigator_actionable") not in ("0", "1") or r.get("interrogator_actionable") not in ("0", "1"):
                missing.append("Actionability was not observed")
                break
            actions = {"ORIENTING", "EXPLORING", "READING_PRIVATE", "PROPOSING", "REVIEWING", "CONFIRMING", "WAITING", "BLOCKED", "IDLE_LOST"}
            if r.get("investigator_action") not in actions or r.get("interrogator_action") not in actions:
                missing.append("Missing/invalid observed actions")
            if r.get("communication_state") not in {"NONE", "SMALL_TALK", "STATUS", "SHARING", "NEGOTIATING", "CONFLICT"}:
                missing.append("Missing/invalid communication observation")
            if r.get("waiting_role") not in {"NONE", "INVESTIGATOR", "INTERROGATOR", "BOTH"}:
                missing.append("Missing/invalid waiting observation")
            if r.get("intervention_category") not in {"NONE", "TECHNICAL", "PROTOCOL", "UI_HINT", "CONTENT_HINT"}:
                missing.append("Missing/invalid intervention category")
            for k in ("private_detail_spoken_before_review", "facilitator_intervention", "technical_error", "waiting_episode_seconds", "wrong_pair_count", "edit_count", "clarification_count"):
                if not r.get(k, "").isdigit():
                    missing.append("Incomplete observation counters")
                    break
        valid_surveys = len(surveys) == 2 and {s["role"] for s in surveys} == set(ROLES)
        if not valid_surveys or any(s["session_id"] != session["id"] or s["has_seen_answer"] != "0"
            or s["completed_case"] not in ("0", "1") or s["wants_next_case"] not in ("0", "1")
            or s["comprehension_score"] not in ("1", "2", "3", "4", "5")
            or not s["blocking_errors"].isdigit() for s in surveys):
            missing.append("Missing/invalid interviews or participant already knew answers")
    except (KeyError, ValueError, IndexError):
        missing.append("Malformed observation/interview data")
    summary = (telemetry or {}).get("summary", {})
    if not telemetry or telemetry.get("bundleHash") != manifest["bundleHash"] or telemetry.get("sessionId") != session["id"]:
        missing.append("Missing/mismatched telemetry")
    elif summary.get("eventCount", 0) <= 0 or summary.get("sessionCount") != 1 or summary.get("isTruncated"):
        missing.append("Telemetry is empty, mixes rooms or is truncated")
    elif summary.get("waitingImbalancePct") is None:
        missing.append("Waiting imbalance not observable; do not substitute zero")
    if missing:
        result.update(status="INCOMPLETE", reasons=sorted(set(missing)))
        return result
    comprehension = sum(int(s["comprehension_score"]) for s in surveys)/2
    wants = sum(int(s["wants_next_case"]) for s in surveys)/2 * 100
    completed = all(s["completed_case"] == "1" for s in surveys)
    sharing = sum(int(r["private_detail_spoken_before_review"]) > 0 for r in observed)
    interventions = sum(int(r["facilitator_intervention"]) for r in observed if r["intervention_category"] in ("UI_HINT", "CONTENT_HINT"))
    blockers = max(int(s["blocking_errors"]) for s in surveys)
    checks = {"Case not completed": completed, "Comprehension below 4": comprehension >= 4,
              "Insufficient spontaneous private sharing": sharing >= 2,
              "Waiting imbalance at least 15%": summary["waitingImbalancePct"] < 15,
              "More than one stuck-player intervention": interventions <= 1, "Blocking technical errors": blockers == 0}
    result.update(status="PASS" if all(checks.values()) else "FAIL", reasons=[k for k, passed in checks.items() if not passed],
                  comprehension=comprehension, wantsNextPct=wants, completed=completed, sharingIntervals=sharing,
                  waitingImbalancePct=summary["waitingImbalancePct"], interventions=interventions, blockers=blockers)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare"); p.add_argument("--batch", required=True)
    p.add_argument("--case", type=Path, action="append", default=[], help="Additional authored case JSON under this repository; repeat to include more cases.")
    p.set_defaults(func=prepare)
    p = commands.add_parser("start"); p.add_argument("--run", type=Path, required=True)
    p.add_argument("--mongod"); p.add_argument("--cloudflared"); p.add_argument("--tunnel", action="store_true")
    p.add_argument("--mongo-port", type=int, default=27024); p.add_argument("--api-port", type=int, default=5236); p.add_argument("--gateway-port", type=int, default=5194); p.set_defaults(func=start)
    p = commands.add_parser("stop"); p.add_argument("--run", type=Path, required=True); p.set_defaults(func=stop)
    p = commands.add_parser("verify"); p.add_argument("--run", type=Path, required=True); p.set_defaults(func=lambda a: print("Frozen bundle verified: " + verify(a.run.resolve())["bundleHash"]))
    p = commands.add_parser("capture"); p.add_argument("--run", type=Path, required=True); p.add_argument("--session", required=True)
    p.add_argument("--from-utc", required=True); p.add_argument("--to-utc", required=True); p.set_defaults(func=capture)
    p = commands.add_parser("report"); p.add_argument("--run", type=Path, required=True); p.set_defaults(func=report)
    args = parser.parse_args()
    try:
        if hasattr(args, "run"):
            args.run.resolve().relative_to((REPO / "tmp/playtest").resolve())
        args.func(args)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Playtest command failed: {error}\n")

if __name__ == "__main__":
    main()
