import * as signalR from '@microsoft/signalr';
import { session } from './session.js';

/**
 * A hub connection that joins no room: it only receives events the server sends to this user
 * (Clients.User), such as "MatchmakingUpdated". Pushes are hints — callers keep polling, so a
 * missing or slow connection only delays updates. Tests set window.__sirlockedNoSignalR to skip it.
 */
export function createUserHubConnection(handlers = {}) {
  let stopped = false;
  if (window.__sirlockedNoSignalR === true) {
    return { async start() {}, async stop() { stopped = true; }, get connected() { return false; } };
  }

  const connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/game', { accessTokenFactory: () => session.token() })
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();
  for (const [event, handler] of Object.entries(handlers)) {
    connection.on(event, (payload) => { if (!stopped) handler(payload); });
  }

  return {
    async start() {
      if (stopped) return;
      try {
        await connection.start();
        if (stopped) await connection.stop();
      } catch {
        // Polling covers a hub that cannot be reached.
      }
    },
    async stop() {
      stopped = true;
      try { await connection.stop(); } catch { /* closing is best effort */ }
    },
    get connected() { return connection.state === 'Connected'; },
  };
}
