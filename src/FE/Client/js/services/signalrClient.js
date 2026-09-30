import * as signalR from '@microsoft/signalr';
import { session } from './session.js';
import { createRoomConnectionLifecycle } from './roomConnectionLifecycle.js';

/**
 * Creates a SignalR connection bound to a room group.
 * Reconnect policy (API_SPEC.md): on reconnect, rejoin the room group and let the
 * caller refetch GET /api/game/rooms/{roomId}/state to replace local state.
 */
export function createRoomConnection(roomId, handlers = {}, { onReconnected, onClose, onStatusChange } = {}) {
  let stopped = false;
  if (window.__sirlockedNoSignalR === true) {
    const localHandlers = { ...handlers };
    const emit = (event, payload) => { if (!stopped) localHandlers[event]?.(payload); };
    window.__sirlockedEmitSignalR = emit;
    return {
      connection: {
        state: 'Connected',
        invoke: async () => {},
        on: (event, handler) => { localHandlers[event] = handler; },
        onclose: () => {},
        onreconnected: () => {},
      },
      async start() { if (!stopped) onStatusChange?.('connected'); },
      async restart() { if (!stopped) { onStatusChange?.('connected'); onReconnected?.(); } },
      async stop() {
        stopped = true;
        if (window.__sirlockedEmitSignalR === emit) delete window.__sirlockedEmitSignalR;
      },
      async sendPing(kind) { await this.connection.invoke('SendPing', roomId, kind); },
    };
  }

  const connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/game', { accessTokenFactory: () => session.token() })
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  for (const [event, handler] of Object.entries(handlers)) {
    connection.on(event, (payload) => { if (!stopped) handler(payload); });
  }

  const lifecycle = createRoomConnectionLifecycle(connection, roomId, { onReconnected, onClose, onStatusChange });

  return {
    connection,
    async sendPing(kind) {
      if (!['DISCOVERY', 'COMPARE', 'WAITING'].includes(kind)) throw new Error('Invalid team ping.');
      await connection.invoke('SendPing', roomId, kind);
    },
    start: lifecycle.start,
    restart: lifecycle.restart,
    async stop() { stopped = true; await lifecycle.stop(); },
  };
}
