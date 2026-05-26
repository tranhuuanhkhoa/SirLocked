import { useEffect, useState } from 'react';
import { getPublishedCases } from '../api/caseApi';
import { createRoom } from '../api/roomApi';
import { navigate } from '../hooks/useNavigate';

export default function CreateRoomPage() {
  const [caseId, setCaseId] = useState('');
  const [cases, setCases] = useState([]);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPublishedCases()
      .then((response) => {
        const nextCases = response.data || [];
        setCases(nextCases);
        setCaseId(nextCases[0]?.caseId || '');
      })
      .catch((err) => setError(err.message));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await createRoom(caseId);
      setRoom(response.data);
      navigate(`/rooms/lobby?roomId=${response.data.id}`);
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
          Case
          <select value={caseId} onChange={(event) => setCaseId(event.target.value)} required>
            {cases.map((gameCase) => (
              <option key={gameCase.caseId} value={gameCase.caseId}>
                {gameCase.title}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!caseId}>Create room</button>
      </form>
      {error && <div className="error">{error}</div>}
      {room && <div className="card">Room code: <strong>{room.roomCode}</strong></div>}
    </section>
  );
}
