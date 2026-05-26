import { useState } from 'react';
import { createRoom } from '../api/roomApi';

export default function CreateRoomPage() {
  const [caseId, setCaseId] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await createRoom(caseId);
      setRoom(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 3</p>
      <h1>Create Room</h1>
      <form onSubmit={submit}>
        <label>
          Case ID
          <input value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="case id from MongoDB" required />
        </label>
        <button>Create room</button>
      </form>
      {error && <div className="error">{error}</div>}
      {room && <div className="card">Room code: <strong>{room.roomCode}</strong></div>}
    </section>
  );
}
