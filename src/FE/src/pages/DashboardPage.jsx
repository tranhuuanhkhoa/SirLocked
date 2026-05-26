import { useAuth } from '../contexts/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <section className="panel">
      <p className="eyebrow">Player area</p>
      <h1>Dashboard</h1>
      <p>Welcome, {user?.fullName}. Week 2 game rooms and case runtime are connected to the .NET API.</p>
      <div className="grid">
        <div className="card">
          <h3>Role</h3>
          <p>{user?.role}</p>
        </div>
        <div className="card">
          <h3>Status</h3>
          <p>{user?.status}</p>
        </div>
        <div className="card">
          <h3>Next</h3>
          <p>Case list, room creation, and realtime lobby start after this base.</p>
        </div>
      </div>
    </section>
  );
}
