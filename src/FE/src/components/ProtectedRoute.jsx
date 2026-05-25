import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="panel">Loading session...</div>;
  }

  if (!isAuthenticated) {
    queueMicrotask(() => navigate('/login'));
    return null;
  }

  return children;
}
