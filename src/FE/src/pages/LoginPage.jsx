import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      const user = await login(form);
      navigate(user.role === 'ADMIN' ? '/admin/users' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-page">
      <form className="panel auth-form" onSubmit={submit}>
        <h1>Login</h1>
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={update} required />
        </label>
        <label>
          Password
          <input name="password" type="password" value={form.password} onChange={update} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={submitting}>{submitting ? 'Logging in...' : 'Login'}</button>
        <button type="button" className="link-button" onClick={() => navigate('/register')}>
          Need an account?
        </button>
      </form>
    </section>
  );
}
