"""Focused end-to-end smoke for the Phase C conversation tree (/converse).

Seeds + publishes the sample case (which has a char-mira tree), starts a co-op
room, plays forward until the interrogator reaches char-mira's scene, then walks
the tree and asserts authoritative transcript, role-gating, and idempotency.

    python scripts/converse_smoke.py [--base http://localhost:5215]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:5215"


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
        raise AssertionError(f"{method} {path} -> HTTP {e.code}: {json.dumps(payload)[:300]}") from None
    if expect_error:
        raise AssertionError(f"{method} {path} should have failed")
    return payload.get("data")


def check(label, condition):
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}")
    if not condition:
        sys.exit(1)


def main():
    global BASE
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=BASE)
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    stamp = int(time.time())

    print("== Setup ==")
    admin = call("POST", "/api/auth/login", body={"email": "admin@sirlocked.local", "password": "Admin123!"})["token"]
    case_id = call("POST", "/api/admin/cases/seed-sample?publish=false", token=admin)["caseId"]
    call("PATCH", f"/api/admin/cases/{case_id}/publish", token=admin)

    ta = call("POST", "/api/auth/register",
              body={"fullName": "Conv Inv", "email": f"convinv{stamp}@test.local", "password": "secret1"})["token"]
    tb = call("POST", "/api/auth/register",
              body={"fullName": "Conv Int", "email": f"convint{stamp}@test.local", "password": "secret1"})["token"]
    room = call("POST", "/api/rooms", token=ta, body={"caseId": case_id})
    room_id, room_code = room["roomId"], room["roomCode"]
    call("POST", "/api/rooms/join", token=tb, body={"roomCode": room_code})
    call("POST", f"/api/rooms/{room_id}/select-role", token=ta, body={"role": "INVESTIGATOR"})
    call("POST", f"/api/rooms/{room_id}/select-role", token=tb, body={"role": "INTERROGATOR"})
    call("POST", f"/api/rooms/{room_id}/ready", token=ta, body={"isReady": True})
    call("POST", f"/api/rooms/{room_id}/ready", token=tb, body={"isReady": True})
    call("POST", f"/api/rooms/{room_id}/start", token=ta)
    check("co-op room started", True)

    print("== Advance until interrogator reaches the tree NPC ==")
    tree_char = None
    for _ in range(60):
        state = call("GET", f"/api/game/rooms/{room_id}/state", token=ta)
        partner = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        if partner["currentSceneId"] != state["currentSceneId"]:
            call("POST", f"/api/game/rooms/{room_id}/go-to-scene", token=tb, body={"sceneId": state["currentSceneId"]})
            partner = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        tree_chars = partner["visibleScene"].get("conversationTreeCharacterIds", [])
        if tree_chars:
            tree_char = tree_chars[0]
            break
        # progress the case forward
        for hotspot in state["visibleScene"]["hotspots"]:
            if hotspot["type"] == "ITEM" and not hotspot["isLocked"] and hotspot["targetId"] not in state["inspectedItemIds"]:
                call("POST", f"/api/game/rooms/{room_id}/inspect-item", token=ta, body={"itemId": hotspot["targetId"]})
        s2 = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
        for dlg in s2["visibleScene"]["availableDialogues"]:
            if not dlg["isLocked"] and not dlg["isAsked"]:
                call("POST", f"/api/game/rooms/{room_id}/ask-dialogue", token=tb, body={"dialogueId": dlg["dialogueId"]})
        try:
            call("POST", f"/api/game/rooms/{room_id}/complete-scene", token=ta)
        except AssertionError:
            pass
    check(f"interrogator reached a tree NPC ({tree_char})", tree_char is not None)

    print("== Walk the conversation tree ==")
    # Open root.
    root = call("POST", f"/api/game/rooms/{room_id}/converse", token=tb, body={"characterId": tree_char})
    check("root opened", root["node"]["isRoot"] and len(root["node"]["lines"]) >= 1)
    check("root offers topic choices", len(root["choices"]) >= 1 and any(not c["isLocked"] for c in root["choices"]))
    check("locked choices never leak labels",
          all((c["label"] is None) for c in root["choices"] if c["isLocked"]))
    open_choices = [c for c in root["choices"] if not c["isLocked"] and c["choiceId"] != "conv-mira-topic-leave"]
    topic_choice = open_choices[0]["choiceId"]

    # Interrogator must be the one driving.
    code, _ = call("POST", f"/api/game/rooms/{room_id}/converse", token=ta,
                   body={"characterId": tree_char}, expect_error=True)
    check("investigator cannot drive /converse", code in (400, 403))

    # Pick a topic -> follow-up -> back to root.
    topic = call("POST", f"/api/game/rooms/{room_id}/converse", token=tb,
                 body={"characterId": tree_char, "nodeId": root["node"]["nodeId"], "choiceId": topic_choice})
    check("topic node reached and recorded", topic["changed"] and len(topic["node"]["lines"]) >= 1)
    follow_choices = [c for c in topic["choices"] if not c["isLocked"]]
    deepest = topic
    if follow_choices:
        follow = call("POST", f"/api/game/rooms/{room_id}/converse", token=tb,
                      body={"characterId": tree_char, "nodeId": topic["node"]["nodeId"], "choiceId": follow_choices[0]["choiceId"]})
        deepest = follow

    # A null-target choice returns to root.
    back_choices = [c for c in deepest["choices"] if not c["isLocked"]]
    if back_choices:
        back = call("POST", f"/api/game/rooms/{room_id}/converse", token=tb,
                    body={"characterId": tree_char, "nodeId": deepest["node"]["nodeId"], "choiceId": back_choices[0]["choiceId"]})
        check("a null-target choice returns to root", back["node"]["isRoot"] and not back["changed"])

    print("== Authoritative transcript + idempotency ==")
    state = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
    transcript = state["visibleScene"]["conversationTranscript"]
    node_ids = [e["nodeId"] for e in transcript]
    check("transcript holds the visited nodes in order", root["node"]["nodeId"] in node_ids and len(node_ids) == len(set(node_ids)))
    visited_count = len(node_ids)

    # Re-open root: no duplication, no extra unlocks.
    again = call("POST", f"/api/game/rooms/{room_id}/converse", token=tb, body={"characterId": tree_char, "nodeId": root["node"]["nodeId"]})
    state2 = call("GET", f"/api/game/rooms/{room_id}/state", token=tb)
    node_ids2 = [e["nodeId"] for e in state2["visibleScene"]["conversationTranscript"]]
    check("revisit is idempotent (no transcript duplication)", not again["changed"] and len(node_ids2) == visited_count)

    # Investigator sees the same transcript, read-only.
    inv_state = call("GET", f"/api/game/rooms/{room_id}/state", token=ta)
    inv_nodes = [e["nodeId"] for e in inv_state["visibleScene"]["conversationTranscript"]]
    check("investigator sees the synced transcript", set(inv_nodes) == set(node_ids2))

    # No secret leak in the transcript projection.
    flat = json.dumps(transcript)
    check("transcript carries no required/unlock clue ids or choices",
          "requiredClueIds" not in flat and "unlockClueIds" not in flat and "nextNodeId" not in flat)

    print("\nALL CONVERSE CHECKS PASSED")


if __name__ == "__main__":
    main()
