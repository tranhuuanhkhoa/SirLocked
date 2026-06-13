"""Play a room via API until accusation unlocks, then optionally accuse.

Usage: py -3 tmp/play_to_accusation.py tmp/roomX.json [--accuse-wrong|--accuse-right]
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:5215"


def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data) as resp:
        return json.loads(resp.read() or b"{}").get("data")


with open(sys.argv[1], encoding="utf-8-sig") as f:
    room = json.load(f)
rid = room["roomId"]
ta, tb = room["investigator"]["token"], room["interrogator"]["token"]

for safety in range(60):
    st = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
    if st["availableForAccusation"]:
        break
    for h in st["visibleScene"]["hotspots"]:
        if h["type"] == "ITEM" and not h["isLocked"] and h["targetId"] not in st["inspectedItemIds"]:
            call("POST", f"/api/game/rooms/{rid}/inspect-item", token=ta, body={"itemId": h["targetId"]})
    st = call("GET", f"/api/game/rooms/{rid}/state", token=tb)
    for d in st["visibleScene"]["availableDialogues"]:
        if not d["isLocked"] and not d["isAsked"]:
            call("POST", f"/api/game/rooms/{rid}/ask-dialogue", token=tb, body={"dialogueId": d["dialogueId"]})
    try:
        call("POST", f"/api/game/rooms/{rid}/complete-scene", token=ta)
    except urllib.error.HTTPError:
        pass
else:
    print("never reached accusation")
    sys.exit(1)

st = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
print("accusation available, clues:", len(st["unlockedClueIds"]))

mode = sys.argv[2] if len(sys.argv) > 2 else None
if mode in ("--accuse-wrong", "--accuse-right"):
    admin = call("POST", "/api/auth/login", body={"email": "admin@sirlocked.local", "password": "Admin123!"})
    full = call("GET", f"/api/admin/cases/{st['caseId']}", token=admin["token"])
    culprit = full["finalLogic"]["culpritId"]
    if mode == "--accuse-wrong":
        target = next(c["characterId"] for c in st["suspects"] if c["characterId"] != culprit)
        evidence = []
    else:
        target = culprit
        evidence = [c["clueId"] for c in st["evidenceClues"]]
    result = call("POST", f"/api/game/rooms/{rid}/accuse", token=ta,
                  body={"culpritId": target, "evidenceIds": evidence})
    print(json.dumps({"accused": target, "success": result["success"], "ending": result["ending"][:200]}, indent=2))
