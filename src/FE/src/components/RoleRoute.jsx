import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function RoleRoute({ roles, children }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="panel">Checking permission...</div>;
  }

  if (!isAuthenticated) {
    queueMicrotask(() => navigate('/login'));
    return null;
  }

  if (!roles.includes(user?.role)) {
    return (
      <div className="panel">
        <h2>Access denied</h2>
        <p>Your account does not have permission to open this page.</p>
        <button onClick={() => navigate('/dashboard')}>Back to dashboard</button>
      </div>
    );
  }

  return children;
}
