"""Quick check: state response now carries collectedItems metadata."""
import json
import sys
import time
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


stamp = int(time.time())
admin = call("POST", "/api/auth/login", body={"email": "admin@sirlocked.local", "password": "Admin123!"})
seeded = call("POST", "/api/admin/cases/seed-sample?publish=true", token=admin["token"])
case_id = seeded["caseId"]

pa = call("POST", "/api/auth/register", body={"fullName": "Inv Check", "email": f"inv{stamp}@test.local", "password": "secret1"})
pb = call("POST", "/api/auth/register", body={"fullName": "Int Check", "email": f"int{stamp}@test.local", "password": "secret1"})
ta, tb = pa["token"], pb["token"]

room = call("POST", "/api/rooms", token=ta, body={"caseId": case_id})
rid = room["roomId"]
call("POST", "/api/rooms/join", token=tb, body={"roomCode": room["roomCode"]})
call("POST", f"/api/rooms/{rid}/select-role", token=ta, body={"role": "INVESTIGATOR"})
call("POST", f"/api/rooms/{rid}/select-role", token=tb, body={"role": "INTERROGATOR"})
call("POST", f"/api/rooms/{rid}/ready", token=ta, body={"isReady": True})
call("POST", f"/api/rooms/{rid}/ready", token=tb, body={"isReady": True})
call("POST", f"/api/rooms/{rid}/start", token=ta)

state = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
for hotspot in state["visibleScene"]["hotspots"]:
    if hotspot["type"] == "ITEM" and not hotspot["isLocked"]:
        call("POST", f"/api/game/rooms/{rid}/inspect-item", token=ta, body={"itemId": hotspot["targetId"]})

state = call("GET", f"/api/game/rooms/{rid}/state", token=ta)
print("collectedItemIds:", state["collectedItemIds"])
print("collectedItems:", json.dumps(state.get("collectedItems"), indent=2)[:600])
ok = (
    isinstance(state.get("collectedItems"), list)
    and len(state["collectedItems"]) == len(state["collectedItemIds"])
    and all(i["name"] for i in state["collectedItems"])
)
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
