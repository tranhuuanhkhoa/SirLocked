import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { navigate } from '../hooks/useNavigate';

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
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
      const user = await register(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-page">
      <form className="panel auth-form" onSubmit={submit}>
        <h1>Register</h1>
        <label>
          Full name
          <input name="fullName" value={form.fullName} onChange={update} minLength={2} required />
        </label>
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={update} required />
        </label>
        <label>
          Password
          <input name="password" type="password" value={form.password} onChange={update} minLength={6} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={submitting}>{submitting ? 'Creating...' : 'Create account'}</button>
        <button type="button" className="link-button" onClick={() => navigate('/login')}>
          Already have an account?
        </button>
      </form>
    </section>
  );
}
