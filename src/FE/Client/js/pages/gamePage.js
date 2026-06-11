import { gameApi } from '../api/gameApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, qs, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderGamePage(app, roomId) {
  render(app, '<div class="page"><p class="muted">Opening the case file…</p></div>');

  const me = session.user();
  let state = null;
  let activeTab = 'clues';
  let selectedCharacterId = null;
  let detailHtml = '';
  let accusation = null; // null | { step, culpritId, evidenceIds:Set, motive, method }
  let stopped = false;

  const introKey = `sirlocked.intro.${roomId}`;

  const refetch = async () => {
    const fresh = await gameApi.state(roomId);
    applyState(fresh);
  };

  function applyState(fresh) {
    if (!fresh || (state && fresh.version < state.version)) return;
    state = fresh;
    if (state.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return;
    }
    draw();
  }

  const hub = createRoomConnection(roomId, {
    GameStateUpdated: (s) => applyState(s),
    ItemFound: ({ userId }) => {
      if (userId !== me.userId) toast('Your partner found something.', 'info');
    },
    ClueUnlocked: ({ clueId, userId }) => {
      if (userId !== me.userId) {
        const clue = state?.unlockedClues.find((c) => c.clueId === clueId);
        toast(`New clue on the board${clue ? `: ${clue.title}` : '.'}`, 'success');
      }
    },
    DialogueAnswered: ({ userId }) => {
      if (userId !== me.userId) toast('Your partner pressed a witness.', 'info');
    },
    SceneChanged: () => toast('The investigation moved to a new location.', 'info'),
    StageChanged: ({ isFinalStageCompleted }) => {
      if (isFinalStageCompleted) toast('Everything points to one person. Prepare the accusation.', 'success', 6000);
    },
    GameCompleted: (result) => {
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    },
    RoomError: ({ message }) => toast(message, 'error'),
  }, { onReconnected: () => { toast('Reconnected — syncing state…', 'info'); refetch().catch(() => {}); } });

  try {
    await refetch();
    if (stopped || !state) return () => hub.stop();
    await hub.start();
  } catch (err) {
    if (err.message?.includes('not started')) {
      window.location.hash = `#/lobby/${roomId}`;
      return undefined;
    }
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return () => hub.stop();
  }

  function myRole() {
    return state.players.find((p) => p.userId === me.userId)?.role ?? null;
  }

  // ----- rendering -----

  function draw() {
    if (stopped || !state) return;
    const scene = state.visibleScene;
    const role = myRole();
    const completed = state.completedSceneIds.length;
    const total = state.sceneMap.length;

    const playersHtml = state.players.map((p) => `
      <span class="chip ${p.userId === me.userId ? 'chip-gold' : ''}" title="${escapeHtml(p.username)}">
        ${escapeHtml(p.username.split(' ')[0])} · ${p.role === 'INVESTIGATOR' ? '🔍' : '🗣'}
      </span>`).join('');

    const hotspots = scene.hotspots.map((h) => {
      const inspected = h.type === 'ITEM' && state.inspectedItemIds.includes(h.targetId);
      const classes = ['hotspot'];
      if (h.isLocked) classes.push('hotspot-locked');
      if (inspected) classes.push('hotspot-done');
      const lockTitle = h.isLocked ? ` (locked — ${h.missingClueIds.length} missing clue${h.missingClueIds.length > 1 ? 's' : ''})` : '';
      return `
      <button class="${classes.join(' ')}" data-hotspot="${escapeHtml(h.hotspotId)}"
              data-type="${escapeHtml(h.type)}" data-target="${escapeHtml(h.targetId)}"
              data-locked="${h.isLocked}"
              style="left:${h.x}%;top:${h.y}%;width:${h.width}%;height:${h.height}%;z-index:${h.zIndex + 5};"
              title="${escapeHtml(h.label)}${lockTitle}" aria-label="${escapeHtml(h.label)}">
        <span class="hotspot-ring"></span>
        <span class="hotspot-label">${h.isLocked ? '🔒 ' : inspected ? '✓ ' : ''}${escapeHtml(h.label)}</span>
      </button>`;
    }).join('');

    const charCards = scene.characters.map((ch) => {
      const dialogues = scene.availableDialogues.filter((d) => d.characterId === ch.characterId);
      const fresh = dialogues.filter((d) => !d.isAsked && !d.isLocked).length;
      return `
      <button class="char-chip ${selectedCharacterId === ch.characterId ? 'is-active' : ''}" data-char="${escapeHtml(ch.characterId)}">
        <span class="char-avatar char-avatar-sm" style="${placeholderStyle(ch.characterId)}">
          <img src="${escapeHtml(ch.imageUrl)}" alt="" onerror="this.remove()">
          <span>${initials(ch.name)}</span>
        </span>
        <span class="char-chip-name">${escapeHtml(ch.name)}</span>
        ${fresh > 0 ? `<span class="badge">${fresh}</span>` : ''}
      </button>`;
    }).join('');

    const sideContent = activeTab === 'clues' ? cluesTab() : activeTab === 'map' ? mapTab() : logTab();

    render(app, `
    <div class="game">
      <div class="game-topbar">
        <div class="game-title">
          <strong>${escapeHtml(state.caseTitle)}</strong>
          <span class="muted small">Room ${escapeHtml(state.roomCode)} · ${completed}/${total} locations resolved</span>
        </div>
        <div class="game-objective" title="Current objective">🧭 ${escapeHtml(state.currentObjective)}</div>
        <div class="game-players">${playersHtml}</div>
      </div>

      <div class="game-main">
        <section class="game-scene">
          <div class="scene-stage" style="${placeholderStyle(scene.sceneId)}">
            <img class="scene-bg-img" src="${escapeHtml(scene.backgroundUrl)}" alt="" onerror="this.remove()">
            <div class="scene-caption">
              <h3>${escapeHtml(scene.title)}</h3>
              <p>${escapeHtml(scene.description)}</p>
            </div>
            ${hotspots}
          </div>
          <div class="char-strip">
            <span class="muted small strip-label">${scene.characters.length ? 'Present:' : 'Nobody else is here.'}</span>
            ${charCards}
          </div>
          <div class="detail-panel" id="detail-panel">${detailHtml || defaultDetail(role)}</div>
        </section>

        <aside class="game-side">
          <div class="side-tabs">
            <button class="side-tab ${activeTab === 'clues' ? 'active' : ''}" data-tab="clues">Clues <span class="badge">${state.unlockedClues.length}</span></button>
            <button class="side-tab ${activeTab === 'map' ? 'active' : ''}" data-tab="map">Map</button>
            <button class="side-tab ${activeTab === 'log' ? 'active' : ''}" data-tab="log">Log</button>
          </div>
          <div class="side-content">${sideContent}</div>
          <div class="side-actions">
            <button class="btn btn-primary btn-block" id="proceed-btn" title="Move on once this location's requirements are met">Continue investigation</button>
            <button class="btn btn-gold btn-block" id="accuse-btn" ${state.availableForAccusation ? '' : 'disabled title="Reach the final confrontation with all key evidence first"'}>
              Final accusation
            </button>
          </div>
        </aside>
      </div>

      ${introOverlay(role)}
      ${accusationModal()}
    </div>`);

    bind();
  }

  function defaultDetail(role) {
    return `<p class="muted">${role === 'INVESTIGATOR'
      ? 'You are the Investigator — click glowing hotspots in the scene to examine physical evidence.'
      : 'You are the Interrogator — select a person below the scene and press them with questions.'}
      Everything either of you finds appears on the shared clue board.</p>`;
  }

  function cluesTab() {
    if (state.unlockedClues.length === 0) {
      return '<div class="empty-state small">No clues yet. Inspect the scene and question witnesses.</div>';
    }
    return state.unlockedClues.slice().reverse().map((c) => `
      <div class="clue-card ${c.isEvidence ? 'clue-evidence' : ''}">
        <div class="clue-head">
          <strong>${escapeHtml(c.title)}</strong>
          ${c.isEvidence ? '<span class="chip chip-gold" title="Usable in the final accusation">EVIDENCE</span>' : ''}
          ${c.isCritical && !c.isEvidence ? '<span class="chip">KEY</span>' : ''}
        </div>
        <p>${escapeHtml(c.content)}</p>
      </div>`).join('');
  }

  function mapTab() {
    return state.sceneMap.map((s) => `
      <button class="map-entry ${s.isCurrent ? 'is-current' : ''} ${s.isCompleted ? 'is-done' : ''}"
              data-scene="${escapeHtml(s.sceneId)}" ${s.isVisited && !s.isCurrent ? '' : 'disabled'}>
        <span>${s.isCompleted ? '✓' : s.isCurrent ? '▶' : s.isVisited ? '·' : '🔒'}</span>
        <span>${s.isVisited ? escapeHtml(s.title) : 'Unknown location'}</span>
        ${s.isCurrent ? '<span class="chip">HERE</span>' : ''}
      </button>`).join('');
  }

  function logTab() {
    if (state.actionLog.length === 0) return '<div class="empty-state small">Nothing logged yet.</div>';
    return state.actionLog.slice().reverse().map((l) => `
      <div class="log-entry">
        <span class="log-time">${new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span>${escapeHtml(l.message)}</span>
      </div>`).join('');
  }

  function introOverlay(role) {
    if (sessionStorage.getItem(introKey)) return '';
    return `
    <div class="overlay" id="intro-overlay">
      <div class="modal">
        <h2>${escapeHtml(state.caseTitle)}</h2>
        <p>${escapeHtml(state.caseSummary)}</p>
        <p class="muted">${role === 'INVESTIGATOR'
          ? 'Your role: INVESTIGATOR. You handle the physical evidence — search every scene.'
          : 'Your role: INTERROGATOR. You handle the people — question everyone and catch the lies.'}</p>
        <button class="btn btn-gold btn-block" id="intro-dismiss">Begin the investigation</button>
      </div>
    </div>`;
  }

  function accusationModal() {
    if (!accusation) return '';
    const evidence = state.evidenceClues;

    if (accusation.step === 1) {
      const suspects = state.suspects.map((sus) => `
        <button class="suspect-card ${accusation.culpritId === sus.characterId ? 'is-selected' : ''}" data-suspect="${escapeHtml(sus.characterId)}">
          <span class="char-avatar" style="${placeholderStyle(sus.characterId)}">
            <img src="${escapeHtml(sus.imageUrl)}" alt="" onerror="this.remove()">
            <span>${initials(sus.name)}</span>
          </span>
          <strong>${escapeHtml(sus.name)}</strong>
          <span class="muted small">${escapeHtml(sus.role)}</span>
        </button>`).join('');

      const evidenceRows = evidence.length === 0
        ? '<div class="empty-state small">No evidence-grade clues unlocked yet.</div>'
        : evidence.map((c) => `
          <label class="evidence-row">
            <input type="checkbox" data-evidence="${escapeHtml(c.clueId)}" ${accusation.evidenceIds.has(c.clueId) ? 'checked' : ''}>
            <span><strong>${escapeHtml(c.title)}</strong><br><span class="muted small">${escapeHtml(c.content)}</span></span>
          </label>`).join('');

      return `
      <div class="overlay">
        <div class="modal modal-wide">
          <h2>Final Accusation</h2>
          <p class="muted">Choose the culprit and the evidence that proves it. A wrong accusation ends the case in failure.</p>
          <h3 class="section-title">Who did it?</h3>
          <div class="suspect-grid">${suspects}</div>
          <h3 class="section-title">Present your evidence</h3>
          <div class="evidence-list">${evidenceRows}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="accuse-cancel">Not yet</button>
            <button class="btn btn-gold" id="accuse-review" ${accusation.culpritId ? '' : 'disabled'}>Review accusation</button>
          </div>
        </div>
      </div>`;
    }

    const culprit = state.suspects.find((sus) => sus.characterId === accusation.culpritId);
    const chosen = evidence.filter((c) => accusation.evidenceIds.has(c.clueId));
    return `
    <div class="overlay">
      <div class="modal">
        <h2>Confirm the accusation</h2>
        <p>You are about to accuse <strong>${escapeHtml(culprit?.name ?? '')}</strong>
           with ${chosen.length} piece${chosen.length === 1 ? '' : 's'} of evidence:</p>
        <ul class="review-list">${chosen.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('') || '<li class="muted">No evidence selected</li>'}</ul>
        <p class="muted small">This decision is final and shared with your partner.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="accuse-back">Go back</button>
          <button class="btn btn-gold" id="accuse-confirm">Accuse ${escapeHtml(culprit?.name ?? '')}</button>
        </div>
      </div>
    </div>`;
  }

  // ----- interactions -----

  function bind() {
    qs('#intro-dismiss', app)?.addEventListener('click', () => {
      sessionStorage.setItem(introKey, '1');
      qs('#intro-overlay', app)?.remove();
    });

    app.querySelectorAll('[data-hotspot]').forEach((h) =>
      h.addEventListener('click', () => onHotspot(h.dataset)));

    app.querySelectorAll('[data-char]').forEach((c) =>
      c.addEventListener('click', () => {
        selectedCharacterId = c.dataset.char;
        showDialoguePanel();
      }));

    app.querySelectorAll('.side-tab').forEach((t) =>
      t.addEventListener('click', () => {
        activeTab = t.dataset.tab;
        draw();
      }));

    app.querySelectorAll('[data-scene]').forEach((s) =>
      s.addEventListener('click', async () => {
        try {
          const res = await gameApi.goToScene(roomId, s.dataset.scene);
          applyState(res.state);
        } catch (err) {
          toast(err.message, 'error');
        }
      }));

    qs('#proceed-btn', app)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const res = await gameApi.completeScene(roomId);
        toast(res.message, 'success', 5500);
        detailHtml = '';
        selectedCharacterId = null;
        applyState(res.state);
      } catch (err) {
        const missing = err.errors?.missing;
        if (missing) {
          const parts = [];
          if (missing.requiredItemIds?.length) parts.push(`${missing.requiredItemIds.length} item(s) to examine`);
          if (missing.requiredDialogueIds?.length) parts.push(`${missing.requiredDialogueIds.length} question(s) to ask`);
          if (missing.requiredClueIds?.length) parts.push(`${missing.requiredClueIds.length} clue(s) to uncover`);
          toast(`Not yet — still missing ${parts.join(', ')}.`, 'error', 5500);
        } else {
          toast(err.message, 'error');
        }
        draw();
      }
    });

    qs('#accuse-btn', app)?.addEventListener('click', () => {
      accusation = { step: 1, culpritId: null, evidenceIds: new Set(state.evidenceClues.map((c) => c.clueId)), motive: '', method: '' };
      draw();
    });

    // accusation modal
    app.querySelectorAll('[data-suspect]').forEach((sBtn) =>
      sBtn.addEventListener('click', () => {
        accusation.culpritId = sBtn.dataset.suspect;
        draw();
      }));
    app.querySelectorAll('[data-evidence]').forEach((box) =>
      box.addEventListener('change', () => {
        if (box.checked) accusation.evidenceIds.add(box.dataset.evidence);
        else accusation.evidenceIds.delete(box.dataset.evidence);
      }));
    qs('#accuse-cancel', app)?.addEventListener('click', () => { accusation = null; draw(); });
    qs('#accuse-review', app)?.addEventListener('click', () => { accusation.step = 2; draw(); });
    qs('#accuse-back', app)?.addEventListener('click', () => { accusation.step = 1; draw(); });
    qs('#accuse-confirm', app)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const result = await gameApi.accuse(roomId, accusation.culpritId, accusation.motive, accusation.method, [...accusation.evidenceIds]);
        sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
        window.location.hash = `#/result/${roomId}`;
      } catch (err) {
        toast(err.message, 'error');
        accusation = null;
        draw();
      }
    });
  }

  async function onHotspot({ type, target, locked }) {
    const role = myRole();
    if (type !== 'ITEM') {
      selectedCharacterId = target;
      showDialoguePanel();
      return;
    }
    if (role !== 'INVESTIGATOR') {
      toast('Only the Investigator can examine evidence — point your partner at it.', 'info');
      return;
    }
    if (locked === 'true') {
      toast('This is locked. Something else must be discovered first.', 'info');
      return;
    }
    try {
      const res = await gameApi.inspectItem(roomId, target);
      const item = res.state.visibleScene.items.find((i) => i.itemId === target);
      detailHtml = `
        <div class="detail-item">
          <h4>🔍 ${escapeHtml(item?.name ?? 'Evidence')}</h4>
          <p>${escapeHtml(res.detail ?? item?.inspectText ?? '')}</p>
          ${res.unlockedClueIds.length > 0 ? '<p class="clue-flash">New clue added to the board.</p>' : ''}
        </div>`;
      if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
      applyState(res.state);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function showDialoguePanel() {
    const scene = state.visibleScene;
    const character = scene.characters.find((c) => c.characterId === selectedCharacterId);
    if (!character) return;
    const role = myRole();
    const dialogues = scene.availableDialogues.filter((d) => d.characterId === selectedCharacterId);

    const rows = dialogues.length === 0
      ? '<p class="muted small">Nothing to ask right now.</p>'
      : dialogues.map((d) => `
        <button class="dialogue-row ${d.isAsked ? 'is-asked' : ''} ${d.isLocked ? 'is-locked' : ''}"
                data-dialogue="${escapeHtml(d.dialogueId)}" ${d.isLocked ? 'disabled' : ''}
                title="${d.isLocked ? `Locked — needs ${d.missingClueIds.length} more clue(s)` : ''}">
          <span>${d.isLocked ? '🔒' : d.isAsked ? '✓' : '❓'}</span>
          <span>${escapeHtml(d.question)}</span>
        </button>
        ${d.isAsked && d.answer ? `<div class="dialogue-answer">“${escapeHtml(d.answer)}”</div>` : ''}`).join('');

    detailHtml = `
      <div class="detail-dialogue">
        <h4>🗣 ${escapeHtml(character.name)} <span class="muted small">${escapeHtml(character.role)}</span></h4>
        <p class="muted small">${escapeHtml(character.description)}</p>
        ${role !== 'INTERROGATOR' ? '<p class="muted small">Only the Interrogator can ask questions — you can read the record.</p>' : ''}
        <div class="dialogue-list">${rows}</div>
        <div id="dialogue-live"></div>
      </div>`;
    draw();

    app.querySelectorAll('[data-dialogue]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (myRole() !== 'INTERROGATOR') {
          toast('Only the Interrogator can ask questions.', 'info');
          return;
        }
        try {
          const res = await gameApi.askDialogue(roomId, btn.dataset.dialogue);
          if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
          applyState(res.state);
          showDialoguePanel(); // refresh with the recorded answer
        } catch (err) {
          toast(err.message, 'error');
        }
      }));
  }

  return () => {
    stopped = true;
    return hub.stop();
  };
}
