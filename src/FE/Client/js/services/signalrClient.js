import * as signalR from '@microsoft/signalr';
import { session } from './session.js';

/**
 * Creates a SignalR connection bound to a room group.
 * Reconnect policy (API_SPEC.md): on reconnect, rejoin the room group and let the
 * caller refetch GET /api/game/rooms/{roomId}/state to replace local state.
 */
export function createRoomConnection(roomId, handlers = {}, { onReconnected, onClose } = {}) {
  if (window.__sirlockedNoSignalR === true) {
    const localHandlers = { ...handlers };
    window.__sirlockedEmitSignalR = (event, payload) => localHandlers[event]?.(payload);
    return {
      connection: {
        state: 'Connected',
        invoke: async () => {},
        on: (event, handler) => { localHandlers[event] = handler; },
        onclose: () => {},
        onreconnected: () => {},
      },
      async start() {},
      async stop() {},
    };
  }

  const connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/game', { accessTokenFactory: () => session.token() })
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  for (const [event, handler] of Object.entries(handlers)) {
    connection.on(event, handler);
  }

  connection.onreconnected(async () => {
    try {
      await connection.invoke('JoinRoom', roomId);
    } catch {
      /* JoinRoom failure surfaces through RoomError */
    }
    onReconnected?.();
  });

  if (onClose) connection.onclose(onClose);

  return {
    connection,
    async start() {
      await connection.start();
      await connection.invoke('JoinRoom', roomId);
    },
    async stop() {
      try {
        await connection.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
