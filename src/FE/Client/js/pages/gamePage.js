import { gameApi } from '../api/gameApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, qs, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderGamePage(app, roomId) {
  render(app, '<div class="page"><p class="muted">Opening the case file...</p></div>');

  const me = session.user();
  const introKey = `sirlocked.intro.${roomId}`;

  let state = null;
  let overlay = null; // { type, ... }
  let selectedInventoryItemId = null;
  let accusation = null;
  let stopped = false;

  const refetch = async () => applyState(await gameApi.state(roomId));

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
        toast(`Evidence added to the case file${clue ? `: ${clue.title}` : '.'}`, 'success');
      }
    },
    DialogueAnswered: ({ userId }) => {
      if (userId !== me.userId) toast('Your partner unlocked new testimony.', 'info');
    },
    SceneChanged: () => toast('You moved to a new location.', 'info'),
    StageChanged: ({ isFinalStageCompleted }) => {
      toast(isFinalStageCompleted
        ? 'The final confrontation is ready.'
        : 'A new lead opens the next location.', 'success', 5500);
    },
    GameCompleted: (result) => {
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    },
    RoomError: ({ message }) => toast(message, 'error'),
  }, { onReconnected: () => { toast('Reconnected. Syncing the room...', 'info'); refetch().catch(() => {}); } });

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

  function draw() {
    if (stopped || !state) return;
    const scene = state.visibleScene;
    const role = myRole();

    render(app, `
    <div class="point-game">
      <header class="game-hud">
        <div>
          <strong>${escapeHtml(scene.title)}</strong>
          <span class="muted small">${escapeHtml(state.caseTitle)} / Room ${escapeHtml(state.roomCode)}</span>
        </div>
        <div class="game-objective">${escapeHtml(state.currentObjective)}</div>
        <div class="game-players">${playersHtml()}</div>
      </header>

      <main class="scene-canvas" style="${placeholderStyle(scene.sceneId)}">
        <img class="scene-bg-img" src="${escapeHtml(scene.backgroundUrl)}" alt="" onerror="this.remove()">
        <div class="scene-vignette"></div>
        <div class="scene-title-card">
          <h2>${escapeHtml(scene.title)}</h2>
          <p>${escapeHtml(scene.description)}</p>
        </div>

        ${hotspotLayer()}
        ${characterLayer()}
        ${sceneNavigationLayer()}

        <div class="scene-tools">
          <button class="round-tool" id="case-file-btn" title="Case file">Case File <span class="badge">${state.unlockedClues.length}</span></button>
          <button class="round-tool" id="map-btn" title="Locations">Map</button>
          <button class="round-tool" id="log-btn" title="Action log">Log</button>
          <button class="round-tool ${state.availableForAccusation ? 'is-hot' : ''}" id="accuse-btn" ${state.availableForAccusation ? '' : 'disabled'} title="Final accusation">Accuse</button>
        </div>
      </main>

      ${inventoryBar()}
      ${introOverlay(role)}
      ${overlayHtml()}
      ${accusationModal()}
    </div>`);

    bind();
  }

  function playersHtml() {
    return state.players.map((p) => `
      <span class="chip ${p.userId === me.userId ? 'chip-gold' : ''}" title="${escapeHtml(p.username)}">
        ${escapeHtml(p.username.split(' ')[0])} / ${p.role === 'INVESTIGATOR' ? 'INV' : 'INT'}
      </span>`).join('');
  }

  function hotspotLayer() {
    return state.visibleScene.hotspots.map((h) => {
      const type = h.type.toUpperCase();
      const inspected = type === 'ITEM' && state.inspectedItemIds.includes(h.targetId);
      const classes = ['scene-hotspot', `scene-hotspot-${type.toLowerCase()}`];
      if (h.isLocked) classes.push('is-locked');
      if (inspected) classes.push('is-done');
      return `
      <button class="${classes.join(' ')}" data-hotspot="${escapeHtml(h.hotspotId)}"
              data-type="${escapeHtml(type)}" data-target="${escapeHtml(h.targetId)}"
              data-label="${escapeHtml(h.label)}" data-locked="${h.isLocked}"
              style="left:${h.x}%;top:${h.y}%;width:${h.width}%;height:${h.height}%;z-index:${h.zIndex + 10};"
              aria-label="${escapeHtml(h.label)}" title="${escapeHtml(h.label)}">
        <span class="hotspot-glow"></span>
        <span class="hotspot-tag">${h.isLocked ? 'Locked' : inspected ? 'Found' : escapeHtml(h.label)}</span>
      </button>`;
    }).join('');
  }

  function characterLayer() {
    const explicitCharacterIds = new Set(
      state.visibleScene.hotspots
        .filter((h) => h.type.toUpperCase() === 'CHARACTER')
        .map((h) => h.targetId));
    const implicitCharacters = state.visibleScene.characters.filter((ch) => !explicitCharacterIds.has(ch.characterId));
    const count = Math.max(implicitCharacters.length, 1);

    return implicitCharacters.map((ch, index) => {
      const x = 58 + (index * 30 / count);
      const fresh = state.visibleScene.availableDialogues
        .filter((d) => d.characterId === ch.characterId && !d.isAsked && !d.isLocked).length;
      return `
      <button class="scene-character" data-char="${escapeHtml(ch.characterId)}"
              style="left:${x}%;top:${36 + (index % 2) * 5}%;z-index:${30 + index};"
              title="Talk to ${escapeHtml(ch.name)}">
        <span class="character-portrait" style="${placeholderStyle(ch.characterId)}">
          <img src="${escapeHtml(ch.imageUrl)}" alt="" onerror="this.remove()">
          <span>${initials(ch.name)}</span>
        </span>
        <span class="character-name">${escapeHtml(ch.name)}${fresh ? ` <b>${fresh}</b>` : ''}</span>
      </button>`;
    }).join('');
  }

  function sceneNavigationLayer() {
    const visited = state.sceneMap.filter((s) => s.isVisited && !s.isCurrent);
    const currentIndex = state.sceneMap.findIndex((s) => s.isCurrent);
    const next = state.sceneMap[currentIndex + 1];
    const completedCurrent = state.completedSceneIds.includes(state.currentSceneId);

    return `
      ${visited.slice(-2).map((s, index) => `
        <button class="scene-exit scene-exit-${index === 0 ? 'left' : 'right'}" data-scene="${escapeHtml(s.sceneId)}">
          ${escapeHtml(s.title)}
        </button>`).join('')}
      <button class="scene-exit scene-exit-forward" id="proceed-btn">
        ${completedCurrent && next ? `Go to ${escapeHtml(next.title)}` : 'Continue investigation'}
      </button>`;
  }

  function inventoryBar() {
    const itemsById = new Map(state.visibleScene.items.map((i) => [i.itemId, i]));
    const collected = state.collectedItemIds.map((id) => itemsById.get(id) ?? { itemId: id, name: prettyId(id), imageUrl: '' });
    return `
    <footer class="inventory-bar">
      <span class="inventory-title">Inventory</span>
      <div class="inventory-items">
        ${collected.length === 0
          ? '<span class="muted small">Collected items appear here.</span>'
          : collected.map((item) => `
            <button class="inventory-item ${selectedInventoryItemId === item.itemId ? 'is-selected' : ''}"
                    data-inventory="${escapeHtml(item.itemId)}" title="${escapeHtml(item.name)}">
              <span class="inventory-icon" style="${placeholderStyle(item.itemId)}">
                <img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">
              </span>
              <span>${escapeHtml(item.name)}</span>
            </button>`).join('')}
      </div>
      <span class="muted small">${selectedInventoryItemId ? `Using: ${prettyId(selectedInventoryItemId)}` : 'Select an item, then click the scene.'}</span>
    </footer>`;
  }

  function introOverlay(role) {
    if (sessionStorage.getItem(introKey)) return '';
    return `
    <div class="overlay" id="intro-overlay">
      <div class="modal">
        <h2>${escapeHtml(state.caseTitle)}</h2>
        <p>${escapeHtml(state.caseSummary)}</p>
        <p class="muted">${role === 'INVESTIGATOR'
          ? 'You are the Investigator. Search the scene, inspect objects, and collect physical evidence.'
          : 'You are the Interrogator. Click people, question them, and use evidence to unlock contradictions.'}</p>
        <button class="btn btn-gold btn-block" id="intro-dismiss">Enter the scene</button>
      </div>
    </div>`;
  }

  function overlayHtml() {
    if (!overlay) return '';
    if (overlay.type === 'case') return caseFileOverlay();
    if (overlay.type === 'map') return mapOverlay();
    if (overlay.type === 'log') return logOverlay();
    if (overlay.type === 'dialogue') return dialogueOverlay(overlay.characterId);
    if (overlay.type === 'inspect') return inspectOverlay(overlay.itemId, overlay.detail, overlay.unlockedClueIds ?? []);
    if (overlay.type === 'puzzle') return puzzleOverlay(overlay.label, overlay.message);
    return '';
  }

  function caseFileOverlay() {
    const clues = state.unlockedClues.slice().reverse();
    return `
    <div class="overlay">
      <div class="modal modal-wide case-file-modal">
        <h2>Case File</h2>
        <p class="muted">Evidence and clues discovered by both players.</p>
        ${clues.length === 0
          ? '<div class="empty-state small">No evidence has been collected yet.</div>'
          : `<div class="case-file-grid">${clues.map((c) => `
              <article class="clue-card ${c.isEvidence ? 'clue-evidence' : ''}">
                <div class="clue-head">
                  <strong>${escapeHtml(c.title)}</strong>
                  ${c.isEvidence ? '<span class="chip chip-gold">EVIDENCE</span>' : ''}
                  ${c.isCritical && !c.isEvidence ? '<span class="chip">KEY</span>' : ''}
                </div>
                <p>${escapeHtml(c.content)}</p>
                <span class="muted small">Source: ${escapeHtml(prettyId(c.source))}</span>
              </article>`).join('')}</div>`}
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function mapOverlay() {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>Investigation Map</h2>
        <p class="muted">Move through places the investigation has already opened.</p>
        <div class="map-list">${state.sceneMap.map((s) => `
          <button class="map-entry ${s.isCurrent ? 'is-current' : ''} ${s.isCompleted ? 'is-done' : ''}"
                  data-scene="${escapeHtml(s.sceneId)}" ${s.isVisited && !s.isCurrent ? '' : 'disabled'}>
            <span>${s.isCompleted ? 'Done' : s.isCurrent ? 'Here' : s.isVisited ? 'Open' : 'Locked'}</span>
            <span>${s.isVisited ? escapeHtml(s.title) : 'Unknown location'}</span>
          </button>`).join('')}</div>
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function logOverlay() {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>Co-op Log</h2>
        ${state.actionLog.length === 0
          ? '<div class="empty-state small">Nothing logged yet.</div>'
          : `<div class="log-list">${state.actionLog.slice().reverse().map((l) => `
              <div class="log-entry">
                <span class="log-time">${new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>${escapeHtml(l.message)}</span>
              </div>`).join('')}</div>`}
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function inspectOverlay(itemId, detail, unlockedClueIds) {
    const item = state.visibleScene.items.find((i) => i.itemId === itemId) ?? { itemId, name: prettyId(itemId), imageUrl: '', description: '' };
    const inspectedText = detail ?? item.inspectText ?? item.description;
    return `
    <div class="overlay">
      <div class="modal modal-wide inspect-modal">
        <div class="inspect-art" style="${placeholderStyle(item.itemId)}">
          <img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="inspect-copy">
          <h2>${escapeHtml(item.name)}</h2>
          <p>${escapeHtml(inspectedText)}</p>
          ${unlockedClueIds.length
            ? `<p class="clue-flash">${unlockedClueIds.length} clue(s) added to the case file.</p>`
            : '<p class="muted small">No new evidence found.</p>'}
          <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
        </div>
      </div>
    </div>`;
  }

  function puzzleOverlay(label, message) {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${escapeHtml(label || 'Locked object')}</h2>
        <p>${escapeHtml(message || 'This needs another clue or item before it can be opened.')}</p>
        <div class="puzzle-pad">
          <button class="puzzle-key" disabled>1</button><button class="puzzle-key" disabled>2</button><button class="puzzle-key" disabled>3</button>
          <button class="puzzle-key" disabled>4</button><button class="puzzle-key" disabled>5</button><button class="puzzle-key" disabled>6</button>
        </div>
        <p class="muted small">Puzzle interactions can be backed by future hotspot JSON. For now this hotspot is gated by case conditions.</p>
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function dialogueOverlay(characterId) {
    const character = state.visibleScene.characters.find((c) => c.characterId === characterId);
    if (!character) return '';
    const role = myRole();
    const dialogues = state.visibleScene.availableDialogues.filter((d) => d.characterId === characterId);
    return `
    <div class="overlay dialogue-overlay">
      <div class="dialogue-box">
        <div class="dialogue-portrait" style="${placeholderStyle(character.characterId)}">
          <img src="${escapeHtml(character.imageUrl)}" alt="" onerror="this.remove()">
          <span>${initials(character.name)}</span>
        </div>
        <div class="dialogue-copy">
          <h2>${escapeHtml(character.name)}</h2>
          <p class="muted">${escapeHtml(character.role)}. ${escapeHtml(character.description)}</p>
          ${role !== 'INTERROGATOR'
            ? '<p class="notice">Only the Interrogator can ask questions. You can still read the testimony.</p>'
            : ''}
          <div class="dialogue-list">
            ${dialogues.length === 0
              ? '<p class="muted small">There is nothing useful to ask right now.</p>'
              : dialogues.map((d) => `
                <button class="dialogue-row ${d.isAsked ? 'is-asked' : ''} ${d.isLocked ? 'is-locked' : ''}"
                        data-dialogue="${escapeHtml(d.dialogueId)}" ${d.isLocked ? 'disabled' : ''}>
                  <span>${d.isLocked ? 'Locked' : d.isAsked ? 'Asked' : 'Ask'}</span>
                  <span>${escapeHtml(d.question)}</span>
                </button>
                ${d.isAsked && d.answer ? `<div class="dialogue-answer">"${escapeHtml(d.answer)}"</div>` : ''}`).join('')}
          </div>
          <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
        </div>
      </div>
    </div>`;
  }

  function accusationModal() {
    if (!accusation) return '';
    const evidence = state.evidenceClues;
    if (accusation.step === 1) {
      return `
      <div class="overlay">
        <div class="modal modal-wide">
          <h2>Final Accusation</h2>
          <p class="muted">Choose the culprit and the evidence. A wrong accusation ends the case.</p>
          <h3 class="section-title">Suspects</h3>
          <div class="suspect-grid">${state.suspects.map((sus) => `
            <button class="suspect-card ${accusation.culpritId === sus.characterId ? 'is-selected' : ''}" data-suspect="${escapeHtml(sus.characterId)}">
              <span class="char-avatar" style="${placeholderStyle(sus.characterId)}">
                <img src="${escapeHtml(sus.imageUrl)}" alt="" onerror="this.remove()">
                <span>${initials(sus.name)}</span>
              </span>
              <strong>${escapeHtml(sus.name)}</strong>
              <span class="muted small">${escapeHtml(sus.role)}</span>
            </button>`).join('')}</div>
          <h3 class="section-title">Evidence</h3>
          <div class="evidence-list">${evidence.length === 0
            ? '<div class="empty-state small">No evidence-grade clues unlocked yet.</div>'
            : evidence.map((c) => `
              <label class="evidence-row">
                <input type="checkbox" data-evidence="${escapeHtml(c.clueId)}" ${accusation.evidenceIds.has(c.clueId) ? 'checked' : ''}>
                <span><strong>${escapeHtml(c.title)}</strong><br><span class="muted small">${escapeHtml(c.content)}</span></span>
              </label>`).join('')}</div>
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
        <p>You are about to accuse <strong>${escapeHtml(culprit?.name ?? '')}</strong> with ${chosen.length} evidence clue(s).</p>
        <ul class="review-list">${chosen.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('') || '<li class="muted">No evidence selected</li>'}</ul>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="accuse-back">Go back</button>
          <button class="btn btn-gold" id="accuse-confirm">Accuse ${escapeHtml(culprit?.name ?? '')}</button>
        </div>
      </div>
    </div>`;
  }

  function bind() {
    qs('#intro-dismiss', app)?.addEventListener('click', () => {
      sessionStorage.setItem(introKey, '1');
      qs('#intro-overlay', app)?.remove();
    });

    app.querySelectorAll('[data-hotspot]').forEach((h) =>
      h.addEventListener('click', () => onHotspot(h.dataset)));

    app.querySelectorAll('[data-char]').forEach((c) =>
      c.addEventListener('click', () => {
        overlay = { type: 'dialogue', characterId: c.dataset.char };
        draw();
      }));

    app.querySelectorAll('[data-inventory]').forEach((button) =>
      button.addEventListener('click', () => {
        selectedInventoryItemId = selectedInventoryItemId === button.dataset.inventory ? null : button.dataset.inventory;
        draw();
      }));

    qs('#case-file-btn', app)?.addEventListener('click', () => { overlay = { type: 'case' }; draw(); });
    qs('#map-btn', app)?.addEventListener('click', () => { overlay = { type: 'map' }; draw(); });
    qs('#log-btn', app)?.addEventListener('click', () => { overlay = { type: 'log' }; draw(); });
    qs('#accuse-btn', app)?.addEventListener('click', () => {
      accusation = { step: 1, culpritId: null, evidenceIds: new Set(state.evidenceClues.map((c) => c.clueId)) };
      draw();
    });

    qs('#proceed-btn', app)?.addEventListener('click', completeScene);
    app.querySelectorAll('[data-scene]').forEach((s) =>
      s.addEventListener('click', async () => {
        try {
          const res = await gameApi.goToScene(roomId, s.dataset.scene);
          overlay = null;
          applyState(res.state);
        } catch (err) {
          toast(err.message, 'error');
        }
      }));

    app.querySelectorAll('[data-close-overlay]').forEach((button) =>
      button.addEventListener('click', () => { overlay = null; draw(); }));

    app.querySelectorAll('[data-dialogue]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (myRole() !== 'INTERROGATOR') {
          toast('Only the Interrogator can ask questions.', 'info');
          return;
        }
        try {
          const res = await gameApi.askDialogue(roomId, button.dataset.dialogue);
          if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
          applyState(res.state);
        } catch (err) {
          toast(err.message, 'error');
        }
      }));

    app.querySelectorAll('[data-suspect]').forEach((button) =>
      button.addEventListener('click', () => {
        accusation.culpritId = button.dataset.suspect;
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
    qs('#accuse-confirm', app)?.addEventListener('click', submitAccusation);
  }

  async function onHotspot({ type, target, locked, label }) {
    if (selectedInventoryItemId) {
      toast(`Tried using ${prettyId(selectedInventoryItemId)} on ${label || prettyId(target)}. No reaction yet.`, 'info');
      selectedInventoryItemId = null;
      draw();
      return;
    }

    if (type === 'CHARACTER') {
      overlay = { type: 'dialogue', characterId: target };
      draw();
      return;
    }

    if (locked === 'true') {
      overlay = { type: 'puzzle', label, message: 'This interaction is locked by missing evidence.' };
      draw();
      return;
    }

    if (type !== 'ITEM' && type !== 'OBJECT' && type !== 'CLUE') {
      overlay = { type: 'puzzle', label, message: 'This hotspot is waiting for a case-specific interaction.' };
      draw();
      return;
    }

    if (myRole() !== 'INVESTIGATOR') {
      toast('Only the Investigator can inspect objects. Tell your partner to check it.', 'info');
      return;
    }

    try {
      const res = await gameApi.inspectItem(roomId, target);
      const inspectedId = target;
      overlay = { type: 'inspect', itemId: inspectedId, detail: res.detail, unlockedClueIds: res.unlockedClueIds };
      if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
      applyState(res.state);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function completeScene(event) {
    event.currentTarget.disabled = true;
    try {
      const res = await gameApi.completeScene(roomId);
      toast(res.message, 'success', 5500);
      overlay = null;
      applyState(res.state);
    } catch (err) {
      const missing = err.errors?.missing;
      if (missing) {
        const parts = [];
        if (missing.requiredItemIds?.length) parts.push(`${missing.requiredItemIds.length} object(s)`);
        if (missing.requiredDialogueIds?.length) parts.push(`${missing.requiredDialogueIds.length} conversation(s)`);
        if (missing.requiredClueIds?.length) parts.push(`${missing.requiredClueIds.length} clue(s)`);
        toast(`Not yet. Still missing ${parts.join(', ')}.`, 'error', 5500);
      } else {
        toast(err.message, 'error');
      }
      draw();
    }
  }

  async function submitAccusation(event) {
    event.currentTarget.disabled = true;
    try {
      const result = await gameApi.accuse(roomId, accusation.culpritId, '', '', [...accusation.evidenceIds]);
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      accusation = null;
      draw();
    }
  }

  function prettyId(id) {
    return String(id ?? '')
      .replace(/^(item|clue|char|dlg|scene|hotspot)-/i, '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  return () => {
    stopped = true;
    return hub.stop();
  };
}
