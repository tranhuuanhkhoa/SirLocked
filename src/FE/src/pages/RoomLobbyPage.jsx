import { useState } from 'react';
import { joinRoom } from '../api/roomApi';
import { getGameHubUrl } from '../services/signalrClient';

export default function RoomLobbyPage() {
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await joinRoom(roomCode);
      setRoom(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 3</p>
      <h1>Room Lobby</h1>
      <p>SignalR hub prepared at: <code>{getGameHubUrl()}</code></p>
      <form onSubmit={submit}>
        <label>
          Room code
          <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={6} required />
        </label>
        <button>Join room</button>
      </form>
      {error && <div className="error">{error}</div>}
      {room && <pre className="card">{JSON.stringify(room, null, 2)}</pre>}
    </section>
  );
}
