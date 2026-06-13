"""Set up a two-player room ready for browser QA.

Creates two fresh players, a room on the published sample case, assigns roles,
readies both, starts the game, and prints a JSON blob with tokens + room info.

Usage: py -3 tmp/setup_room.py [--no-start]
"""
import argparse
import json
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


parser = argparse.ArgumentParser()
parser.add_argument("--no-start", action="store_true")
parser.add_argument("--case", default=None)
args = parser.parse_args()

stamp = int(time.time())
admin = call("POST", "/api/auth/login", body={"email": "admin@sirlocked.local", "password": "Admin123!"})
if args.case:
    case_id = args.case
else:
    seeded = call("POST", "/api/admin/cases/seed-sample?publish=true", token=admin["token"])
    case_id = seeded["caseId"]

pa = call("POST", "/api/auth/register", body={"fullName": "Khoa Investigator", "email": f"qa-inv-{stamp}@test.local", "password": "secret1"})
pb = call("POST", "/api/auth/register", body={"fullName": "Binh Interrogator", "email": f"qa-int-{stamp}@test.local", "password": "secret1"})

room = call("POST", "/api/rooms", token=pa["token"], body={"caseId": case_id})
rid = room["roomId"]
call("POST", "/api/rooms/join", token=pb["token"], body={"roomCode": room["roomCode"]})
call("POST", f"/api/rooms/{rid}/select-role", token=pa["token"], body={"role": "INVESTIGATOR"})
call("POST", f"/api/rooms/{rid}/select-role", token=pb["token"], body={"role": "INTERROGATOR"})
call("POST", f"/api/rooms/{rid}/ready", token=pa["token"], body={"isReady": True})
call("POST", f"/api/rooms/{rid}/ready", token=pb["token"], body={"isReady": True})
if not args.no_start:
    call("POST", f"/api/rooms/{rid}/start", token=pa["token"])

print(json.dumps({
    "roomId": rid,
    "roomCode": room["roomCode"],
    "caseId": case_id,
    "investigator": {"token": pa["token"], "user": pa["user"]},
    "interrogator": {"token": pb["token"], "user": pb["user"]},
}))
