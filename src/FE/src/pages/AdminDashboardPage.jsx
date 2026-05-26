import { useEffect, useState } from 'react';
import { apiRequest } from '../api/apiClient';

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest('/admin/dashboard')
      .then((response) => setDashboard(response.data))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section className="panel">
      <p className="eyebrow">Member 5</p>
      <h1>Admin Dashboard</h1>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        {['totalUsers', 'totalCases', 'totalRooms', 'totalResults'].map((key) => (
          <div className="card" key={key}>
            <h3>{key}</h3>
            <p>{dashboard?.[key] ?? 0}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
