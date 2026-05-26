import { useState } from 'react';
import { createAiCaseDraft } from '../api/aiCaseApi';

export default function AiCaseCreatorPage() {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await createAiCaseDraft({ prompt });
      setDraft(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 5</p>
      <h1>AI Case Creator</h1>
      <p>Week 1 placeholder. Deepseek, Gemini, ChatGPT, and Cloudinary are configured later.</p>
      <form onSubmit={submit}>
        <label>
          Case idea
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} required />
        </label>
        <button>Create draft</button>
      </form>
      {error && <div className="error">{error}</div>}
      {draft && <pre className="card">{JSON.stringify(draft, null, 2)}</pre>}
    </section>
  );
}
