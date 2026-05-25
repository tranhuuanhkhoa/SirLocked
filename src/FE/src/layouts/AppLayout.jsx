import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function AppLayout({ children }) {
  const { user, isAuthenticated, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>SirLocked</button>
        <nav>
          <button onClick={() => navigate('/')}>Home</button>
          {isAuthenticated && <button onClick={() => navigate('/dashboard')}>Dashboard</button>}
          {user?.role === 'ADMIN' && <button onClick={() => navigate('/admin/users')}>Admin Users</button>}
        </nav>
        <div className="topbar-actions">
          {isAuthenticated ? (
            <>
              <span>{user.fullName} ({user.role})</span>
              <button onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/login')}>Login</button>
              <button onClick={() => navigate('/register')}>Register</button>
            </>
          )}
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
