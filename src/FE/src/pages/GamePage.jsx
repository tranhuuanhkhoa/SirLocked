import { useState } from 'react';
import { getGameState } from '../api/gameApi';

export default function GamePage() {
  const [roomId, setRoomId] = useState('');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  const loadState = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await getGameState(roomId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 4</p>
      <h1>Gameplay Runtime</h1>
      <p>Week 1 runtime contract scaffold. Item/clue/dialogue logic starts later.</p>
      <form onSubmit={loadState}>
        <label>
          Room ID
          <input value={roomId} onChange={(event) => setRoomId(event.target.value)} required />
        </label>
        <button>Load game state</button>
      </form>
      {error && <div className="error">{error}</div>}
      {state && <pre className="card">{JSON.stringify(state, null, 2)}</pre>}
    </section>
  );
}
