import { useEffect, useRef, useState } from 'react';
import { getRoom, getRoomMessages, joinRoom, leaveRoom, selectRole, setReady, startRoom } from '../api/roomApi';
import { navigate } from '../hooks/useNavigate';
import { createGameHubConnection, getGameHubUrl } from '../services/signalrClient';

const LAST_ROOM_KEY = 'sirlocked.lastRoomId';

export default function RoomLobbyPage() {
  const [roomCode, setRoomCode] = useState('');
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('roomId') || localStorage.getItem(LAST_ROOM_KEY) || '');
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatMessage, setChatMessage] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const connectionRef = useRef(null);

  const loadRoom = async (id = roomId) => {
    if (!id) return;
    const response = await getRoom(id);
    setRoom(response.data);
  };

  useEffect(() => {
    if (!roomId) return;
    Promise.all([
      loadRoom(roomId),
      getRoomMessages(roomId).then((response) => setMessages(response.data || [])),
    ]).catch((err) => setError(err.message));
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    let disposed = false;
    const connection = createGameHubConnection();
    connection.on('RoomUpdated', (nextRoom) => {
      if (nextRoom.id === roomId) setRoom(nextRoom);
    });
    connection.on('RolesUpdated', (nextRoom) => {
      if (nextRoom.id === roomId) setRoom(nextRoom);
    });
    connection.on('ReadyUpdated', (nextRoom) => {
      if (nextRoom.id === roomId) setRoom(nextRoom);
    });
    connection.on('PlayerLeft', (nextRoom) => {
      if (nextRoom.id === roomId) setRoom(nextRoom);
    });
    connection.on('GameStarted', (nextRoom) => {
      if (nextRoom.id === roomId) {
        setRoom(nextRoom);
        setMessage('Game started.');
      }
    });
    connection.on('RoomMessageReceived', (nextMessage) => {
      if (nextMessage.roomId === roomId) {
        setMessages((current) => [...current, nextMessage].slice(-50));
      }
    });
    connection.on('RoomError', (event) => {
      if (event.roomId === roomId) setError(event.message);
    });
    connection.start()
      .then(() => {
        if (disposed) return null;
        connectionRef.current = connection;
        return connection.invoke('JoinRoom', roomId);
      })
      .catch((err) => {
        if (!disposed) setError(err.message);
      });

    return () => {
      disposed = true;
      connection.invoke('LeaveRoom', roomId).catch(() => {});
      connection.stop().catch(() => {});
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [roomId]);

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await joinRoom(roomCode);
      setRoom(response.data);
      setRoomId(response.data.id);
      localStorage.setItem(LAST_ROOM_KEY, response.data.id);
      window.history.replaceState({}, '', `/rooms/lobby?roomId=${response.data.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const updateReady = async (isReady) => {
    try {
      setError('');
      const response = await setReady(room.id, isReady);
      setRoom(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  const updateRole = async (gameRole) => {
    try {
      setError('');
      const response = await selectRole(room.id, gameRole);
      setRoom(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  const start = async () => {
    try {
      setError('');
      const response = await startRoom(room.id);
      setRoom(response.data);
      setMessage('Game started.');
      navigate(`/game?roomId=${room.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const leave = async () => {
    try {
      setError('');
      await leaveRoom(room.id);
      setRoom(null);
      setRoomId('');
      localStorage.removeItem(LAST_ROOM_KEY);
      window.history.replaceState({}, '', '/rooms/lobby');
      setMessage('You left the room.');
    } catch (err) {
      setError(err.message);
    }
  };

  const sendChat = async (event) => {
    event.preventDefault();
    if (!chatMessage.trim() || !connectionRef.current || !room?.id) return;

    try {
      setError('');
      await connectionRef.current.invoke('SendRoomMessage', room.id, chatMessage);
      setChatMessage('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 3</p>
      <h1>Room Lobby</h1>
      <p>Join a room code, set two different roles, ready up, then start the investigation.</p>
      <p>SignalR hub: <code>{getGameHubUrl()}</code></p>
      <form onSubmit={submit}>
        <label>
          Room code
          <input
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            maxLength={6}
            placeholder="VD: 4AB3F1"
            required
          />
        </label>
        <button>Join room</button>
      </form>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {room && (
        <div className="stack">
          <div className="card">
            <h3>Room {room.roomCode}</h3>
            <p>Status: <strong>{room.status}</strong></p>
            <p>Case: {room.caseId}</p>
            <div className="actions">
              <button onClick={() => updateReady(true)}>Ready</button>
              <button className="secondary" onClick={() => updateReady(false)}>Not ready</button>
              <button disabled={!room.canStart} onClick={start}>Start game</button>
              <button className="secondary" onClick={() => navigate(`/game?roomId=${room.id}`)}>Open game</button>
              <button className="secondary" onClick={leave}>Leave</button>
            </div>
          </div>
          <div className="grid">
            {room.players.map((player) => (
              <div className="card" key={player.userId}>
                <h3>{player.fullName}</h3>
                <p>{player.isHost ? 'Host' : 'Player'} · {player.isReady ? 'Ready' : 'Not ready'}</p>
                <p>Role: {player.gameRole || 'Not selected'}</p>
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => updateRole('INVESTIGATOR')}>Use Investigator</button>
            <button className="secondary" onClick={() => updateRole('INTERROGATOR')}>Use Interrogator</button>
            <button className="secondary" onClick={() => loadRoom()}>Refresh</button>
          </div>
          <div className="card">
            <h3>Room Chat</h3>
            <div className="stack">
              {messages.map((chat) => (
                <div key={chat.id || `${chat.userId}-${chat.sentAt}`}>
                  <strong>{chat.fullName}</strong>: {chat.message}
                </div>
              ))}
              {messages.length === 0 && <p>No messages yet.</p>}
            </div>
            <form onSubmit={sendChat}>
              <label>
                Message
                <input value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} maxLength={500} />
              </label>
              <button>Send</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
