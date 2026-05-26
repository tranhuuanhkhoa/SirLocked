import { useEffect, useState } from 'react';
import { accuse, askDialogue, completeScene, completeStage, getGameState, inspectItem, presentEvidence } from '../api/gameApi';
import { createGameHubConnection } from '../services/signalrClient';

export default function GamePage() {
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('roomId') || '');
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState([]);
  const [evidenceByDialogue, setEvidenceByDialogue] = useState({});
  const [actionPending, setActionPending] = useState('');
  const [accusation, setAccusation] = useState({
    culpritId: '',
    motive: '',
    method: '',
    evidenceIds: '',
  });
  const [error, setError] = useState('');

  const loadState = async () => {
    if (!roomId) return;
    try {
      setError('');
      const response = await getGameState(roomId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!roomId) return undefined;
    let disposed = false;
    const connection = createGameHubConnection();
    connection.on('GameStateUpdated', (nextState) => {
      if (nextState.roomId === roomId) setState(nextState);
    });
    connection.on('ItemFound', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Item found: ${event.itemId}`, ...current].slice(0, 8));
      }
    });
    connection.on('ClueUnlocked', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Clue unlocked: ${event.clueId}`, ...current].slice(0, 8));
      }
    });
    connection.on('DialogueAnswered', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Dialogue answered: ${event.dialogueId}`, ...current].slice(0, 8));
      }
    });
    connection.on('EvidencePresented', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Evidence presented: ${event.evidenceId}`, ...current].slice(0, 8));
      }
    });
    connection.on('SceneChanged', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Scene changed: ${event.currentSceneId}`, ...current].slice(0, 8));
      }
    });
    connection.on('StageChanged', (event) => {
      if (event.roomId === roomId) {
        setEvents((current) => [`Stage changed: ${event.currentStageId}`, ...current].slice(0, 8));
      }
    });
    connection.on('GameCompleted', (nextResult) => {
      if (nextResult.roomId === roomId) setResult(nextResult);
    });
    connection.start()
      .then(() => {
        if (disposed) return null;
        return connection.invoke('JoinRoom', roomId);
      })
      .catch((err) => {
        if (!disposed) setError(err.message);
      });

    return () => {
      disposed = true;
      connection.invoke('LeaveRoom', roomId).catch(() => {});
      connection.stop().catch(() => {});
    };
  }, [roomId]);

  const submitLoadState = async (event) => {
    event.preventDefault();
    await loadState();
  };

  const handleInspect = async (itemId) => {
    try {
      setActionPending(`inspect:${itemId}`);
      setError('');
      const response = await inspectItem(roomId, itemId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const handleAskDialogue = async (dialogueId) => {
    try {
      setActionPending(`ask:${dialogueId}`);
      setError('');
      const response = await askDialogue(roomId, dialogueId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const handlePresentEvidence = async (dialogueId) => {
    const evidenceId = evidenceByDialogue[dialogueId];
    if (!evidenceId) return;

    try {
      setActionPending(`evidence:${dialogueId}`);
      setError('');
      const response = await presentEvidence(roomId, dialogueId, evidenceId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const handleCompleteScene = async () => {
    try {
      setActionPending('complete-scene');
      setError('');
      const response = await completeScene(roomId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const handleCompleteStage = async () => {
    try {
      setActionPending('complete-stage');
      setError('');
      const response = await completeStage(roomId);
      setState(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const submitAccusation = async (event) => {
    event.preventDefault();
    try {
      setActionPending('accuse');
      setError('');
      const response = await accuse(roomId, {
        culpritId: accusation.culpritId,
        motive: accusation.motive,
        method: accusation.method,
        evidenceIds: accusation.evidenceIds.split(',').map((id) => id.trim()).filter(Boolean),
      });
      setResult(response.data);
      await loadState();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionPending('');
    }
  };

  const setField = (field, value) => {
    setAccusation((current) => ({ ...current, [field]: value }));
  };

  const setDialogueEvidence = (dialogueId, evidenceId) => {
    setEvidenceByDialogue((current) => ({ ...current, [dialogueId]: evidenceId }));
  };

  const dialogueIsUnlocked = (dialogue) => (
    dialogue.requiredClueIds || []
  ).every((clueId) => state?.foundClueIds?.includes(clueId));

  const foundEvidenceOptions = state
    ? [
        ...state.foundClues.map((clue) => ({ id: clue.clueId, label: clue.title })),
        ...state.sceneItems
          .filter((item) => state.foundItemIds.includes(item.itemId))
          .map((item) => ({ id: item.itemId, label: item.name })),
      ]
    : [];

  return (
    <section className="panel">
      <p className="eyebrow">Member 4</p>
      <h1>Gameplay Runtime</h1>
      <p>Inspect scene items, collect clues, and submit the final theory when the evidence is ready.</p>
      <form onSubmit={submitLoadState}>
        <label>
          Room ID
          <input value={roomId} onChange={(event) => setRoomId(event.target.value)} required />
        </label>
        <button>Load game state</button>
      </form>
      {error && <div className="error">{error}</div>}
      {state && (
        <div className="stack">
          <div className="card">
            <h3>{state.caseTitle}</h3>
            <p>{state.caseSummary}</p>
            <p>Status: <strong>{state.status}</strong></p>
            <p>Stage: <strong>{state.currentStage?.title || state.currentStageId}</strong></p>
            <p>Scene: <strong>{state.currentScene?.title || state.currentSceneId}</strong></p>
            <div className="actions">
              <button
                disabled={!state.canCompleteScene || state.status !== 'PLAYING' || actionPending === 'complete-scene'}
                onClick={handleCompleteScene}
              >
                {state.hasNextScene ? 'Complete scene' : 'Mark final scene complete'}
              </button>
              <button
                className="secondary"
                disabled={!state.canCompleteStage || state.status !== 'PLAYING' || actionPending === 'complete-stage'}
                onClick={handleCompleteStage}
              >
                {state.hasNextStage ? 'Complete stage' : 'Complete final stage'}
              </button>
            </div>
          </div>
          <div className="grid">
            {state.sceneItems.map((item) => (
              <div className="card" key={item.itemId}>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <button disabled={state.foundItemIds.includes(item.itemId) || state.status !== 'PLAYING' || actionPending === `inspect:${item.itemId}`} onClick={() => handleInspect(item.itemId)}>
                  {state.foundItemIds.includes(item.itemId) ? 'Inspected' : 'Inspect'}
                </button>
              </div>
            ))}
          </div>
          <div className="grid">
            {state.foundClues.map((clue) => (
              <div className="card" key={clue.clueId}>
                <h3>{clue.title}</h3>
                <p>{clue.content}</p>
                <code>{clue.clueId}</code>
              </div>
            ))}
          </div>
          <div className="grid">
            {state.availableDialogues.map((dialogue) => {
              const unlocked = dialogueIsUnlocked(dialogue);
              const asked = state.askedDialogueIds.includes(dialogue.dialogueId);
              return (
                <div className="card" key={dialogue.dialogueId}>
                  <h3>{dialogue.question}</h3>
                  <p>{asked ? dialogue.answer : unlocked ? 'Ready to ask.' : `Locked: ${dialogue.requiredClueIds.join(', ')}`}</p>
                  <button disabled={!unlocked || state.status !== 'PLAYING' || actionPending === `ask:${dialogue.dialogueId}`} onClick={() => handleAskDialogue(dialogue.dialogueId)}>
                    {asked ? 'Ask again' : 'Ask'}
                  </button>
                  <label>
                    Evidence
                    <select
                      value={evidenceByDialogue[dialogue.dialogueId] || ''}
                      onChange={(event) => setDialogueEvidence(dialogue.dialogueId, event.target.value)}
                      disabled={!unlocked || foundEvidenceOptions.length === 0}
                    >
                      <option value="">Select evidence</option>
                      {foundEvidenceOptions.map((evidence) => (
                        <option key={evidence.id} value={evidence.id}>
                          {evidence.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary"
                    disabled={!unlocked || !evidenceByDialogue[dialogue.dialogueId] || state.status !== 'PLAYING' || actionPending === `evidence:${dialogue.dialogueId}`}
                    onClick={() => handlePresentEvidence(dialogue.dialogueId)}
                  >
                    Present evidence
                  </button>
                </div>
              );
            })}
          </div>
          <div className="card">
            <h3>Realtime activity</h3>
            {events.length === 0 ? (
              <p>No item or clue events yet.</p>
            ) : (
              <ul>
                {events.map((event, index) => (
                  <li key={`${event}-${index}`}>{event}</li>
                ))}
              </ul>
            )}
          </div>
          <form onSubmit={submitAccusation} className="card">
            <h3>Final accusation</h3>
            <label>
              Culprit
              <select value={accusation.culpritId} onChange={(event) => setField('culpritId', event.target.value)} required>
                <option value="">Select suspect</option>
                {state.characters.map((character) => (
                  <option key={character.characterId} value={character.characterId}>
                    {character.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motive
              <input value={accusation.motive} onChange={(event) => setField('motive', event.target.value)} placeholder="Hidden debt" required />
            </label>
            <label>
              Method
              <input value={accusation.method} onChange={(event) => setField('method', event.target.value)} placeholder="Poisoned drink" required />
            </label>
            <label>
              Evidence IDs
              <input value={accusation.evidenceIds} onChange={(event) => setField('evidenceIds', event.target.value)} placeholder="clue-debt, clue-balcony, clue-poison" required />
            </label>
            <button disabled={state.status !== 'PLAYING' || actionPending === 'accuse'}>Submit accusation</button>
          </form>
          {result && (
            <div className="card">
              <h3>{result.success ? 'Solved' : 'Not solved'}</h3>
              <p>{result.message}</p>
              <p>Room: <code>{result.roomId}</code></p>
              <p>Completed: {new Date(result.completedAt).toLocaleString()}</p>
              {!result.success && <p>Missing evidence: {result.missingEvidenceIds.join(', ') || 'None'}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
