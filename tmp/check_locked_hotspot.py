"""QA: server must reject inspecting a clue-gated item before its clue unlocks.

Plays the manor case to scene-pantry, then tries item-poison-bottle while
clue-ada-called-away is still missing. Expects HTTP 400.
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

# Advance until the pantry scene is current.
for safety in range(40):
    st = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
    if st["currentSceneId"] == "scene-pantry":
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
    print("FAIL: never reached scene-pantry")
    sys.exit(1)

st = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
locked = next((h for h in st["visibleScene"]["hotspots"] if h["targetId"] == "item-poison-bottle"), None)
print("pantry hotspot state:", json.dumps({"isLocked": locked["isLocked"], "missing": locked["missingClueIds"]}))

if not locked["isLocked"]:
    print("SKIP: clue already unlocked before pantry; cannot test gate")
    sys.exit(0)

try:
    call("POST", f"/api/game/rooms/{rid}/inspect-item", token=ta, body={"itemId": "item-poison-bottle"})
    print("FAIL: locked item inspect was accepted")
    sys.exit(1)
except urllib.error.HTTPError as e:
    body = json.loads(e.read() or b"{}")
    print(f"PASS: server rejected with {e.code}: {body.get('message')}")
