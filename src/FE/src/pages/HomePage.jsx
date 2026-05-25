import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function HomePage() {
  const { isAuthenticated } = useAuth();

  return (
    <section className="hero">
      <div>
        <p className="eyebrow">Multiplayer detective game</p>
        <h1>SirLocked</h1>
        <p>
          Login, create a two-player investigation room, split roles, collect clues,
          and prepare for AI-generated cases in later weeks.
        </p>
        <div className="actions">
          <button onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login')}>
            {isAuthenticated ? 'Open dashboard' : 'Login to play'}
          </button>
          <button className="secondary" onClick={() => navigate('/register')}>Create account</button>
        </div>
      </div>
    </section>
  );
}
