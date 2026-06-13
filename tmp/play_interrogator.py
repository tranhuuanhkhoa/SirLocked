"""Drive the interrogator for one scene: ask every unlocked, unasked dialogue.

Usage: py -3 tmp/play_interrogator.py tmp/room2.json
"""
import json
import sys
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
rid, tok = room["roomId"], room["interrogator"]["token"]

state = call("GET", f"/api/game/rooms/{rid}/state", token=tok)
asked = []
for dlg in state["visibleScene"]["availableDialogues"]:
    if dlg["isLocked"] or dlg["isAsked"]:
        continue
    res = call("POST", f"/api/game/rooms/{rid}/ask-dialogue", token=tok, body={"dialogueId": dlg["dialogueId"]})
    asked.append({"dialogueId": dlg["dialogueId"], "newClues": res["unlockedClueIds"]})

state = call("GET", f"/api/game/rooms/{rid}/state", token=tok)
print(json.dumps({"asked": asked, "objective": state["currentObjective"], "clues": len(state["unlockedClueIds"])}, indent=2))
