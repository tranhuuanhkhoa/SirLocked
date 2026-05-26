import { useState } from 'react';
import { createAiCaseDraft } from '../api/aiCaseApi';
import { importCaseJson } from '../api/caseApi';

export default function AiCaseCreatorPage() {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    try {
      setError('');
      const response = await createAiCaseDraft({ prompt });
      setDraft(response.data);
      setMessage('');
    } catch (err) {
      setError(err.message);
    }
  };

  const importDraft = async () => {
    try {
      setError('');
      const gameCase = JSON.parse(draft.generatedJson);
      const response = await importCaseJson(gameCase);
      setMessage(`Imported ${response.data.case.title}. Publish it from Admin Dashboard.`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel">
      <p className="eyebrow">Member 5</p>
      <h1>AI Case Creator</h1>
      <p>Week 2 uses a deterministic mock provider that produces a valid case JSON draft for review and import.</p>
      <form onSubmit={submit}>
        <label>
          Case idea
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} required />
        </label>
        <button>Create draft</button>
      </form>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {draft && (
        <div className="stack">
          <div className="card">
            <h3>{draft.status}</h3>
            <p>{draft.prompt}</p>
            <button onClick={importDraft}>Import draft as case</button>
          </div>
          <pre className="card">{draft.generatedJson}</pre>
        </div>
      )}
    </section>
  );
}
