"""End-to-end API smoke test for the SirLocked MVP.

Plays the published sample case from registration to final accusation using
only the public API, exactly like the frontend would. Run while the backend
is up (default http://localhost:5215):

    python scripts/e2e_smoke.py [--base http://localhost:5215]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:5215"


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {json.dumps(body)[:400]}")
        self.status = status
        self.body = body


def call(method, path, token=None, body=None, expect_error=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as resp:
            payload = json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read() or b"{}")
        if expect_error:
            return e.code, payload
        raise ApiError(e.code, payload) from None
    if expect_error:
        raise AssertionError(f"{method} {path} should have failed but returned 200")
    return payload.get("data")


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {label}")
    if not condition:
        sys.exit(1)


def poll_draft(token, draft_id, expected, timeout_seconds=60):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        draft = call("GET", f"/api/admin/ai-cases/{draft_id}", token=token)
        if draft["status"] in expected and draft.get("queueState", "NONE") == "NONE":
            return draft
        time.sleep(0.25)
    raise AssertionError(f"AI draft {draft_id} did not reach {expected}")


def main():
    global BASE
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=BASE)
    args = parser.parse_args()
    BASE = args.base.rstrip("/")

    stamp = int(time.time())

    print("== Admin: login, seed, publish ==")
    admin = call("POST", "/api/auth/login", body={"email": "admin@sirlocked.local", "password": "Admin123!"})
    admin_token = admin["token"]
    check("admin login", admin["user"]["role"] == "ADMIN")

    seeded = call("POST", "/api/admin/cases/seed-sample?publish=false", token=admin_token)
    case_id = seeded["caseId"]
    check(f"sample case seeded as draft ({case_id})", seeded["status"] == "DRAFT")

    published = call("PATCH", f"/api/admin/cases/{case_id}/publish", token=admin_token)
    check("sample case published", published["status"] == "PUBLISHED")
    full_case = call("GET", f"/api/admin/cases/{case_id}", token=admin_token)
    challenge_by_id = {c["challengeId"]: c for c in full_case.get("evidenceChallenges", [])}
    deduction_by_id = {d["deductionId"]: d for d in full_case.get("deductions", [])}

    bad_case = {"caseJson": {"caseId": "case-broken", "title": "Broken", "stages": [],
                             "characters": [], "items": [], "clues": [], "dialogues": [],
                             "finalLogic": {}}}
    status, body = call("POST", "/api/admin/cases/validate", token=admin_token, body=bad_case, expect_error=False), None
    check("validator rejects broken case", status["isValid"] is False and len(status["errors"]) > 0)

    print("== Players: register ==")
    pa = call("POST", "/api/auth/register",
              body={"fullName": "Player Alpha", "email": f"alpha{stamp}@test.local", "password": "secret1"})
    pb = call("POST", "/api/auth/register",
              body={"fullName": "Player Beta", "email": f"beta{stamp}@test.local", "password": "secret1"})
    ta, tb = pa["token"], pb["token"]
    check("two players registered as PLAYER", pa["user"]["role"] == "PLAYER" and pb["user"]["role"] == "PLAYER")

    print("== Room flow ==")
    room = call("POST", "/api/rooms", token=ta, body={"caseId": case_id})
    room_id, room_code = room["roomId"], room["roomCode"]
    check(f"room created (code {room_code})", room["status"] == "WAITING")

    code, _ = call("POST", f"/api/rooms/{room_id}/start", token=ta, expect_error=True)
    check("start before second player fails", code == 400)

    room = call("POST", "/api/rooms/join", token=tb, body={"roomCode": room_code})
    check("player B joined", len(room["players"]) == 2)

    call("POST", f"/api/rooms/{room_id}/select-role", token=ta, body={"role": "INVESTIGATOR"})
    code, _ = call("POST", f"/api/rooms/{room_id}/select-role", token=tb, body={"role": "INVESTIGATOR"}, expect_error=True)
    check("duplicate role rejected", code == 409)
    call("POST", f"/api/rooms/{room_id}/select-role", token=tb, body={"role": "INTERROGATOR"})

    call("POST", f"/api/rooms/{room_id}/ready", token=ta, body={"isReady": True})
    call("POST", f"/api/rooms/{room_id}/ready", token=tb, body={"isReady": True})
    room = call("POST", f"/api/rooms/{room_id}/start", token=ta)
    check("host started game", room["status"] == "IN_PROGRESS")

    print("== Gameplay ==")
    state = call("GET", f"/api/game/rooms/{room_id}/state", token=ta)
    check("initial scene rendered with hotspots",
          bool(state["visibleScene"]["sceneId"]) and len(state["visibleScene"]["hotspots"]) > 0)
    hint = call("POST", f"/api/game/rooms/{room_id}/hint", token=ta,
                body={"contextType": "SCENE", "targetId": state["currentSceneId"]})
    repeated_hint = call("POST", f"/api/game/rooms/{room_id}/hint", token=ta,
                         body={"contextType": "SCENE", "targetId": state["currentSceneId"]})
    check("V2 hint is persisted and exhausted hint is idempotent", hint["isNew"] and not repeated_hint["isNew"])

    first_item = state["visibleScene"]["hotspots"][0]["targetId"]
    code, body = call("POST", f"/api/game/rooms/{room_id}/inspect-item", token=tb,
                      body={"itemId": first_item}, expect_error=True)
    check("interrogator cannot inspect items", code == 403)

    # Play the whole case: inspect everything available, ask everything available,
    # complete scenes until the final accusation unlocks.
    for safety in range(60):
        state = call("GET", f"/api/game/rooms/{room_id}/state", token=ta)
        if state["availableForAccusation"]:
            break
        progressed = False
        scene = state["visibleScene"]
        unlocked = set(state["unlockedClueIds"])

        partner_state = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        if partner_state["currentSceneId"] != state["currentSceneId"]:
            call("POST", f"/api/game/rooms/{room_id}/go-to-scene", token=tb,
                 body={"sceneId": state["currentSceneId"]})

        for hotspot in scene["hotspots"]:
            if hotspot["type"] != "ITEM" or hotspot["isLocked"]:
                continue
            item_id = hotspot["targetId"]
            if item_id in state["inspectedItemIds"]:
                continue
            result = call("POST", f"/api/game/rooms/{room_id}/inspect-item", token=ta, body={"itemId": item_id})
            progressed = progressed or result["changed"]

        state = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        for dlg in state["visibleScene"]["availableDialogues"]:
            if dlg["isLocked"] or dlg["isAsked"]:
                continue
            result = call("POST", f"/api/game/rooms/{room_id}/ask-dialogue", token=tb, body={"dialogueId": dlg["dialogueId"]})
            progressed = progressed or result["changed"]

        state = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        for dlg in state["visibleScene"]["availableDialogues"]:
            for challenge in dlg.get("evidenceChallenges", []):
                if challenge["isResolved"]:
                    continue
                authored = challenge_by_id[challenge["challengeId"]]
                result = call("POST", f"/api/game/rooms/{room_id}/present-evidence", token=tb,
                              body={"challengeId": challenge["challengeId"], "evidenceId": authored["correctEvidenceId"]})
                progressed = progressed or result["changed"]

        state = call("GET", f"/api/game/rooms/{room_id}/state", token=ta)
        for deduction in state.get("deductions", []):
            if deduction["isSolved"] or not deduction["isAvailable"]:
                continue
            authored = deduction_by_id[deduction["deductionId"]]
            result = call("POST", f"/api/game/rooms/{room_id}/solve-deduction", token=ta,
                          body={"deductionId": deduction["deductionId"], "optionId": authored["correctOptionId"]})
            progressed = progressed or result["changed"]

        try:
            call("POST", f"/api/game/rooms/{room_id}/complete-scene", token=ta)
            progressed = True
        except ApiError as e:
            if not progressed:
                print(f"  [FAIL] stuck: {json.dumps(e.body)[:300]}")
                sys.exit(1)
    else:
        print("  [FAIL] never reached accusation")
        sys.exit(1)

    check("accusation became available", state["availableForAccusation"])
    check("clue board populated", len(state["unlockedClues"]) >= 8)
    check("action log populated", len(state["actionLog"]) > 5)

    # Wrong accusation first (wrong culprit) must produce a FAIL result, not an error...
    # but accusing ends the game, so test the wrong path on validation level instead:
    code, _ = call("POST", f"/api/game/rooms/{room_id}/accuse", token=ta,
                   body={"culpritId": "char-nobody", "evidenceIds": []}, expect_error=True)
    check("accusing an unknown character is rejected", code == 400)

    evidence_ids = [c["clueId"] for c in state["evidenceClues"]]
    suspects = {c["characterId"] for c in state["suspects"]}

    # Find the real culprit by asking the backend for the result of a correct accusation.
    # The sample case culprit is part of the suspect list; pick it from finalLogic via admin case detail.
    culprit = full_case["finalLogic"]["culpritId"]
    check("culprit is one of the suspects shown to players", culprit in suspects)

    result = call("POST", f"/api/game/rooms/{room_id}/accuse", token=ta,
                  body={"culpritId": culprit,
                        "motiveId": full_case["finalLogic"]["correctMotiveId"],
                        "methodId": full_case["finalLogic"]["correctMethodId"],
                        "evidenceLinks": full_case["finalLogic"]["requiredEvidenceLinks"]})
    check("correct accusation wins", result["success"] is True)
    check("V2 result reports each accusation component", result["culpritResult"]["isCorrect"]
          and result["motiveResult"]["isCorrect"] and result["methodResult"]["isCorrect"]
          and all(item["isCorrect"] for item in result["evidenceResults"]))
    check("Full V2 result calculates score and teamwork", result["scoreSummary"]["totalScore"] >= 0
          and result["scoreSummary"]["rank"] and 0 <= result["scoreSummary"]["teamworkScore"] <= 15)
    check("win ending text returned", len(result["ending"]) > 10)

    result2 = call("GET", f"/api/game/rooms/{room_id}/result", token=tb)
    check("result retrievable by partner", result2["success"] is True)

    print("== Wrong accusation produces fail result (second room) ==")
    room2 = call("POST", "/api/rooms", token=ta, body={"caseId": case_id})
    call("POST", "/api/rooms/join", token=tb, body={"roomCode": room2["roomCode"]})
    call("POST", f"/api/rooms/{room2['roomId']}/select-role", token=ta, body={"role": "INVESTIGATOR"})
    call("POST", f"/api/rooms/{room2['roomId']}/select-role", token=tb, body={"role": "INTERROGATOR"})
    call("POST", f"/api/rooms/{room2['roomId']}/ready", token=ta, body={"isReady": True})
    call("POST", f"/api/rooms/{room2['roomId']}/ready", token=tb, body={"isReady": True})
    call("POST", f"/api/rooms/{room2['roomId']}/start", token=ta)
    rid2 = room2["roomId"]
    for safety in range(60):
        st = call("GET", f"/api/game/rooms/{rid2}/state", token=ta)
        if st["availableForAccusation"]:
            break
        partner = call("GET", f"/api/game/rooms/{rid2}/state", token=tb)
        if partner["currentSceneId"] != st["currentSceneId"]:
            call("POST", f"/api/game/rooms/{rid2}/go-to-scene", token=tb, body={"sceneId": st["currentSceneId"]})
        for hotspot in st["visibleScene"]["hotspots"]:
            if hotspot["type"] == "ITEM" and not hotspot["isLocked"] and hotspot["targetId"] not in st["inspectedItemIds"]:
                call("POST", f"/api/game/rooms/{rid2}/inspect-item", token=ta, body={"itemId": hotspot["targetId"]})
        st = call("GET", f"/api/game/rooms/{rid2}/state", token=tb)
        for dlg in st["visibleScene"]["availableDialogues"]:
            if not dlg["isLocked"] and not dlg["isAsked"]:
                call("POST", f"/api/game/rooms/{rid2}/ask-dialogue", token=tb, body={"dialogueId": dlg["dialogueId"]})
        st = call("GET", f"/api/game/rooms/{rid2}/state", token=tb)
        for dlg in st["visibleScene"]["availableDialogues"]:
            for challenge in dlg.get("evidenceChallenges", []):
                if not challenge["isResolved"]:
                    authored = challenge_by_id[challenge["challengeId"]]
                    call("POST", f"/api/game/rooms/{rid2}/present-evidence", token=tb,
                         body={"challengeId": challenge["challengeId"], "evidenceId": authored["correctEvidenceId"]})
        st = call("GET", f"/api/game/rooms/{rid2}/state", token=ta)
        for deduction in st.get("deductions", []):
            if not deduction["isSolved"] and deduction["isAvailable"]:
                authored = deduction_by_id[deduction["deductionId"]]
                call("POST", f"/api/game/rooms/{rid2}/solve-deduction", token=ta,
                     body={"deductionId": deduction["deductionId"], "optionId": authored["correctOptionId"]})
        try:
            call("POST", f"/api/game/rooms/{rid2}/complete-scene", token=ta)
        except ApiError:
            pass
    wrong_suspect = next(c["characterId"] for c in st["suspects"] if c["characterId"] != culprit)
    fail_result = call("POST", f"/api/game/rooms/{rid2}/accuse", token=tb,
                       body={"culpritId": wrong_suspect,
                             "motiveId": full_case["finalLogic"]["correctMotiveId"],
                             "methodId": full_case["finalLogic"]["correctMethodId"],
                             "evidenceLinks": full_case["finalLogic"]["requiredEvidenceLinks"]})
    check("wrong accusation returns fail result (not an error)", fail_result["success"] is False)
    check("wrong accusation identifies the incorrect component", fail_result["culpritResult"]["isCorrect"] is False)
    check("fail ending text returned", len(fail_result["ending"]) > 10)

    print("== Mock AI queued workflow ==")
    draft = call("POST", "/api/admin/ai-cases", token=admin_token,
                 body={"prompt": "A jewel heist during a thunderstorm at the observatory", "stageCount": 3})
    check("AI story preview accepted into Mongo queue",
          draft["status"] == "GENERATING_STORY" and draft["queueState"] == "PENDING")
    draft = poll_draft(admin_token, draft["draftId"], {"STORY_AWAITING_APPROVAL"})
    check(f"AI story preview generated by {draft['provider']}", draft["storyPreview"] is not None)

    call("POST", f"/api/admin/ai-cases/{draft['draftId']}/approve", token=admin_token)
    draft = poll_draft(admin_token, draft["draftId"],
                       {"CASE_TRUTH_AWAITING_APPROVAL", "CASE_TRUTH_INVALID"})
    check("truth gate passed", draft["status"] == "CASE_TRUTH_AWAITING_APPROVAL")
    check("Short/normal truth respects its advertised trace budget",
          draft["truthSummary"]["traceCount"] <= draft["truthSummary"]["maxTraces"])

    call("POST", f"/api/admin/ai-cases/{draft['draftId']}/approve-truth", token=admin_token)
    draft = poll_draft(admin_token, draft["draftId"],
                       {"FULL_LOGIC_AWAITING_APPROVAL", "GENERATED_INVALID"})
    check("mock gameplay projection passed", draft["status"] == "FULL_LOGIC_AWAITING_APPROVAL")

    call("POST", f"/api/admin/ai-cases/{draft['draftId']}/approve-full-logic", token=admin_token)
    draft = poll_draft(admin_token, draft["draftId"],
                       {"SCENE_LAYOUT_AWAITING_APPROVAL", "GENERATED_INVALID"})
    check("mock scene layout gate passed", draft["status"] == "SCENE_LAYOUT_AWAITING_APPROVAL")

    call("POST", f"/api/admin/ai-cases/{draft['draftId']}/approve-scene-layout", token=admin_token)
    draft = poll_draft(admin_token, draft["draftId"],
                       {"READY_TO_PUBLISH", "GENERATED_INVALID"})
    check("mock final asset gate passed", draft["status"] == "READY_TO_PUBLISH")

    ai_case = call("POST", f"/api/admin/ai-cases/{draft['draftId']}/publish?overwrite=true",
                   token=admin_token)
    check("mock AI draft published through the full HTTP flow", ai_case["status"] == "PUBLISHED")

    published_list = call("GET", "/api/cases/published", token=ta)
    check("players see published cases", any(c["caseId"] == case_id for c in published_list))

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
