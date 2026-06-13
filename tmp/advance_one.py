"""Advance the room exactly one scene: inspect this scene's items, ask its
dialogues, then complete-scene. Prints the resulting scene id.

Usage: py -3 tmp/advance_one.py tmp/roomv.json
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

st = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
start = st["currentSceneId"]
for h in st["visibleScene"]["hotspots"]:
    if h["type"] == "ITEM" and not h["isLocked"] and h["targetId"] not in st["inspectedItemIds"]:
        call("POST", f"/api/game/rooms/{rid}/inspect-item", token=ta, body={"itemId": h["targetId"]})
st = call("GET", f"/api/game/rooms/{rid}/state", token=tb)
for d in st["visibleScene"]["availableDialogues"]:
    if not d["isLocked"] and not d["isAsked"]:
        call("POST", f"/api/game/rooms/{rid}/ask-dialogue", token=tb, body={"dialogueId": d["dialogueId"]})
try:
    res = call("POST", f"/api/game/rooms/{rid}/complete-scene", token=ta)
    print(json.dumps({"from": start, "to": res["state"]["currentSceneId"]}))
except urllib.error.HTTPError as e:
    print(json.dumps({"from": start, "error": json.loads(e.read() or b"{}")}))
