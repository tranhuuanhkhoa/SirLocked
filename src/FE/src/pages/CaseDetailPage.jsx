import { useEffect, useState } from 'react';
import { getCaseDetail } from '../api/caseApi';
import { createRoom } from '../api/roomApi';
import { navigate } from '../hooks/useNavigate';

export default function CaseDetailPage() {
  const [caseId] = useState(() => new URLSearchParams(window.location.search).get('caseId') || '');
  const [gameCase, setGameCase] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!caseId) {
      setError('Case id is required.');
      return;
    }

    getCaseDetail(caseId)
      .then((response) => setGameCase(response.data.case))
      .catch((err) => setError(err.message));
  }, [caseId]);

  const startRoom = async () => {
    try {
      setBusy(true);
      setError('');
      const response = await createRoom(gameCase.caseId);
      navigate(`/rooms/lobby?roomId=${response.data.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 2</p>
      <h1>{gameCase?.title || 'Case Detail'}</h1>
      {error && <div className="error">{error}</div>}
      {gameCase && (
        <div className="stack">
          <div className="card">
            <p>{gameCase.summary}</p>
            <p>Status: <strong>{gameCase.status}</strong> · {gameCase.estimatedMinutes} minutes</p>
            <div className="actions">
              <button disabled={busy || gameCase.status !== 'PUBLISHED'} onClick={startRoom}>
                {busy ? 'Creating...' : 'Create room'}
              </button>
              <button className="secondary" onClick={() => navigate('/cases')}>Back to cases</button>
            </div>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Characters</h3>
              {gameCase.characters.map((character) => (
                <p key={character.characterId}>{character.name} · {character.role}</p>
              ))}
            </div>
            <div className="card">
              <h3>Scenes</h3>
              {gameCase.stages.flatMap((stage) => stage.scenes).map((scene) => (
                <p key={scene.sceneId}>{scene.title}</p>
              ))}
            </div>
            <div className="card">
              <h3>Clues</h3>
              {gameCase.clues.map((clue) => (
                <p key={clue.clueId}>{clue.title}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

