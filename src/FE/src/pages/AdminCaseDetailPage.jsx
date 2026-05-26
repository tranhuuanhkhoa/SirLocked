import { useEffect, useState } from 'react';
import { getAdminCaseDetail, publishCase, unpublishCase } from '../api/caseApi';
import { navigate } from '../hooks/useNavigate';

export default function AdminCaseDetailPage() {
  const [caseId] = useState(() => new URLSearchParams(window.location.search).get('caseId') || '');
  const [gameCase, setGameCase] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await getAdminCaseDetail(caseId);
    setGameCase(response.data.case);
  };

  useEffect(() => {
    if (!caseId) {
      setError('Case id is required.');
      return;
    }

    load().catch((err) => setError(err.message));
  }, [caseId]);

  const toggleStatus = async () => {
    try {
      setError('');
      if (gameCase.status === 'PUBLISHED') {
        await unpublishCase(gameCase.caseId);
        setMessage('Case unpublished.');
      } else {
        await publishCase(gameCase.caseId);
        setMessage('Case published.');
      }
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 2 + Member 5</p>
      <h1>{gameCase?.title || 'Admin Case Detail'}</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {gameCase && (
        <div className="stack">
          <div className="card">
            <p>{gameCase.summary}</p>
            <p>Case ID: <code>{gameCase.caseId}</code></p>
            <p>Status: <strong>{gameCase.status}</strong></p>
            <div className="actions">
              <button onClick={toggleStatus}>{gameCase.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</button>
              <button className="secondary" onClick={() => navigate('/admin/dashboard')}>Back to admin</button>
            </div>
          </div>

          <div className="grid">
            <div className="card">
              <h3>Stages</h3>
              {gameCase.stages.map((stage) => (
                <p key={stage.stageId}>{stage.order}. {stage.title} ({stage.scenes.length} scenes)</p>
              ))}
            </div>
            <div className="card">
              <h3>Items</h3>
              {gameCase.items.map((item) => (
                <p key={item.itemId}>{item.name} → {item.unlockClueIds.join(', ')}</p>
              ))}
            </div>
            <div className="card">
              <h3>Final Logic</h3>
              <p>Culprit: <code>{gameCase.finalLogic.culpritId}</code></p>
              <p>Motive: {gameCase.finalLogic.motive}</p>
              <p>Method: {gameCase.finalLogic.method}</p>
              <p>Evidence: {gameCase.finalLogic.requiredEvidenceIds.join(', ')}</p>
            </div>
          </div>

          <pre className="card">{JSON.stringify(gameCase, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
