/* sound: a soft bowl-like chime, richer with rarity */
let AC = null;
/* `new AudioContext()` stalls the page for a moment: it must not happen at the instant an entrance reveals its hero */
export function warmChime() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* audio unavailable */ }
}
export function chime(r) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
    const notes = { common: [392], rare: [392, 587.3], myth: [392, 523.3, 784], leg: [329.6, 440, 659.3, 880], gold: [392, 523.3, 659.3, 784, 1046.5] }[r] || [392], t0 = AC.currentTime + 0.02;
    notes.forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + i * .11); g.gain.exponentialRampToValueAtTime(0.06, t0 + i * .11 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * .11 + 1.6); o.connect(g); g.connect(AC.destination); o.start(t0 + i * .11); o.stop(t0 + i * .11 + 1.7); });
  } catch (e) { /* audio unavailable */ }
}
