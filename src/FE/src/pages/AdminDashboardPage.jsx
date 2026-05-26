import { useEffect, useState } from 'react';
import { getAdminLogs, getAdminResults } from '../api/adminApi';
import { apiRequest } from '../api/apiClient';
import { getAdminCases, publishCase, seedDemoCases, unpublishCase } from '../api/caseApi';
import { navigate } from '../hooks/useNavigate';

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [cases, setCases] = useState([]);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const [dashboardResponse, casesResponse, logsResponse, resultsResponse] = await Promise.all([
      apiRequest('/admin/dashboard'),
      getAdminCases(),
      getAdminLogs(),
      getAdminResults(),
    ]);
    setDashboard(dashboardResponse.data);
    setCases(casesResponse.data || []);
    setLogs(logsResponse.data || []);
    setResults(resultsResponse.data || []);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const seed = async () => {
    try {
      setError('');
      const response = await seedDemoCases();
      setMessage(`${response.data.length} demo cases are ready.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleCase = async (gameCase) => {
    try {
      setError('');
      if (gameCase.status === 'PUBLISHED') {
        await unpublishCase(gameCase.caseId);
      } else {
        await publishCase(gameCase.caseId);
      }
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 5</p>
      <h1>Admin Dashboard</h1>
      <div className="actions">
        <button onClick={seed}>Seed demo cases</button>
        <button className="secondary" onClick={() => navigate('/admin/rooms')}>Room history</button>
        <button className="secondary" onClick={() => load().catch((err) => setError(err.message))}>Refresh</button>
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="grid">
        {['totalUsers', 'totalCases', 'totalRooms', 'totalResults'].map((key) => (
          <div className="card" key={key}>
            <h3>{key}</h3>
            <p>{dashboard?.[key] ?? 0}</p>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <h2>Cases</h2>
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Status</th>
              <th>Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((gameCase) => (
              <tr key={gameCase.caseId}>
                <td>{gameCase.title}</td>
                <td>{gameCase.status}</td>
                <td>{gameCase.estimatedMinutes}m</td>
                <td>
                  <div className="actions">
                    <button className="secondary" onClick={() => navigate(`/admin/cases/detail?caseId=${gameCase.caseId}`)}>
                      View
                    </button>
                    <button className="secondary" onClick={() => toggleCase(gameCase)}>
                      {gameCase.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <h2>Recent Action Logs</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Room</th>
              <th>User</th>
              <th>Action</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
                <td><code>{log.roomId}</code></td>
                <td><code>{log.userId}</code></td>
                <td>{log.actionType}</td>
                <td><code>{log.payloadJson}</code></td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan="5">No gameplay actions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <h2>Recent Results</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Case</th>
              <th>Room</th>
              <th>User</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.resultId}>
                <td>{new Date(result.completedAt).toLocaleString()}</td>
                <td>{result.caseId}</td>
                <td><code>{result.roomId}</code></td>
                <td><code>{result.submittedByUserId}</code></td>
                <td>{result.success ? 'Solved' : 'Failed'}</td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan="5">No completed games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
