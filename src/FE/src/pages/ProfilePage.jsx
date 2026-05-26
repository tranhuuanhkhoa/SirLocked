import { useEffect, useState } from 'react';
import { getMyResults, updateProfile } from '../api/userApi';
import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { user, refreshMe } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getMyResults()
      .then((response) => setResults(response.data || []))
      .catch((err) => setError(err.message));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await updateProfile({ fullName });
      setMessage(response.message || 'Profile updated.');
      await refreshMe();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 1</p>
      <h1>Profile</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <form onSubmit={submit}>
        <label>
          Full name
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} required />
        </label>
        <button>Save profile</button>
      </form>
      <div className="card">
        <p>Email: {user?.email}</p>
        <p>Role: {user?.role}</p>
        <p>Status: {user?.status}</p>
      </div>
      <div className="table-wrap">
        <h2>Result History</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Case</th>
              <th>Room</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.resultId}>
                <td>{new Date(result.completedAt).toLocaleString()}</td>
                <td>{result.caseId}</td>
                <td><code>{result.roomId}</code></td>
                <td>{result.success ? 'Solved' : 'Failed'}</td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan="4">No completed games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
