// QA: second realtime client. Connects to the SignalR hub as the interrogator,
// joins the room, streams a few player poses, and reports every event it hears.
// Usage: node tmp/hub_partner.mjs tmp/room4.json scene-backstage-hallway
import { readFileSync } from 'node:fs';
import signalR from '../src/FE/node_modules/@microsoft/signalr/dist/cjs/index.js';

const roomFile = process.argv[2];
const sceneId = process.argv[3] ?? '';
const raw = readFileSync(roomFile, 'utf8').replace(/^﻿/, '');
const room = JSON.parse(raw);
const { roomId } = room;
const token = room.interrogator.token;

const connection = new signalR.HubConnectionBuilder()
  .withUrl(`http://localhost:5215/hubs/game?access_token=${encodeURIComponent(token)}`, {
    accessTokenFactory: () => token,
  })
  .configureLogging(signalR.LogLevel.Warning)
  .build();

const heard = [];
for (const ev of ['GameStateUpdated', 'PlayerPoseUpdated', 'PlayerPoseLeft', 'ItemFound', 'ClueUnlocked', 'RoomError']) {
  connection.on(ev, (payload) => heard.push({ ev, payload: ev === 'GameStateUpdated' ? { version: payload?.version } : payload }));
}

await connection.start();
await connection.invoke('JoinRoom', roomId);
console.log('joined room', roomId);

for (let i = 0; i < 5; i++) {
  await connection.invoke('UpdatePlayerPose', roomId, {
    sceneId,
    x: 300 + i * 40,
    y: 520,
    direction: i % 2 ? 'left' : 'right',
    moving: true,
  });
  await new Promise((r) => setTimeout(r, 250));
}
// Final idle pose so the remote sprite settles.
await connection.invoke('UpdatePlayerPose', roomId, { sceneId, x: 500, y: 520, direction: 'left', moving: false });

// Listen a while for events triggered by the other player.
await new Promise((r) => setTimeout(r, 15000));
console.log(JSON.stringify({ heard }, null, 2));
await connection.stop();
