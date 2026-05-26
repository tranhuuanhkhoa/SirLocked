import { useEffect, useState } from 'react';
import { getPublishedCases } from '../api/caseApi';
import { createRoom } from '../api/roomApi';
import { navigate } from '../hooks/useNavigate';

export default function CaseListPage() {
  const [cases, setCases] = useState([]);
  const [error, setError] = useState('');
  const [busyCaseId, setBusyCaseId] = useState('');

  useEffect(() => {
    getPublishedCases()
      .then((response) => setCases(response.data || []))
      .catch((err) => setError(err.message));
  }, []);

  const handleCreateRoom = async (caseId) => {
    try {
      setError('');
      setBusyCaseId(caseId);
      const response = await createRoom(caseId);
      navigate(`/rooms/lobby?roomId=${response.data.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyCaseId('');
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 2</p>
      <h1>Case System</h1>
      <p>Choose a published investigation case and open a two-player room.</p>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        {cases.map((gameCase) => (
          <div className="card" key={gameCase.id || gameCase.caseId}>
            <h3>{gameCase.title}</h3>
            <p>{gameCase.summary}</p>
            <p>{gameCase.estimatedMinutes} minutes</p>
            <div className="actions">
              <button className="secondary" onClick={() => navigate(`/cases/detail?caseId=${gameCase.caseId}`)}>
                Details
              </button>
              <button disabled={busyCaseId === gameCase.caseId} onClick={() => handleCreateRoom(gameCase.caseId)}>
                {busyCaseId === gameCase.caseId ? 'Creating...' : 'Create room'}
              </button>
            </div>
          </div>
        ))}
        {cases.length === 0 && !error && <div className="card">No published cases yet.</div>}
      </div>
    </section>
  );
}
