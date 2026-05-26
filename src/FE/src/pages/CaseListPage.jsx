import { useEffect, useState } from 'react';
import { getPublishedCases } from '../api/caseApi';

export default function CaseListPage() {
  const [cases, setCases] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getPublishedCases()
      .then((response) => setCases(response.data || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section className="panel">
      <p className="eyebrow">Member 2</p>
      <h1>Case System</h1>
      <p>Week 1 case list scaffold. Real import/publish flow continues in the next weeks.</p>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        {cases.map((gameCase) => (
          <div className="card" key={gameCase.id || gameCase.caseId}>
            <h3>{gameCase.title}</h3>
            <p>{gameCase.summary}</p>
          </div>
        ))}
        {cases.length === 0 && !error && <div className="card">No published cases yet.</div>}
      </div>
    </section>
  );
}
