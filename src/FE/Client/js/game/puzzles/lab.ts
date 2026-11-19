/// <reference types="vite/client" />
/**
 * Development harness for interactive puzzle kinds (open /puzzle-lab.html on the Vite dev server with
 * the API running in Development). It generates a fresh per-case instance on the server, mounts the
 * kind inside the real puzzle host and sends answers/probes to the real server checks.
 * Authored content for a kind can live in ./fixtures/<kind>.json as { params, solution, reveal, prompt, title }.
 */
import { createPuzzleHost, type PuzzleHostModel } from './host';
import { knownPuzzleKinds } from './registry';

const fixtures = import.meta.glob<{ default: any }>('./fixtures/*.json', { eager: true });
const fixtureFor = (kind: string) => fixtures[`./fixtures/${kind}.json`]?.default ?? {};
const tr = (en: string, vi: string) => (document.documentElement.lang === 'en' ? en : vi);

let instance: { params: any; solution: any; reveal: any } | null = null;
let run: any = null;
let view: any = null;
let model: PuzzleHostModel | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const kindSelect = $<HTMLSelectElement>('lab-kind');
const debug = $<HTMLPreElement>('lab-debug');

async function call(path: string, body: unknown) {
  const response = await fetch(`/api/dev/puzzle-lab/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(text || response.statusText);
  return JSON.parse(text);
}

function base() {
  const kind = kindSelect.value;
  return { kind, difficulty: $<HTMLSelectElement>('lab-diff').value, seed: Number($<HTMLInputElement>('lab-seed').value) || 0 };
}

function runView() {
  const used = Number(run?.data?.hints ?? 0);
  const hints: string[] = (instance?.solution?.hints ?? []).slice(0, used);
  return { attempts: run?.attempts ?? 0, probesUsed: run?.probesUsed ?? 0, hints, ...(view ?? {}) };
}

const host = createPuzzleHost({
  slot: $('lab-puzzle-slot'),
  tr,
  submit: async (_id, answer) => {
    const result = await call('check', { ...base(), ...instance, answer, run });
    run = result.run;
    view = result.view ?? view;
    if (model) {
      model = { ...model, solved: result.solved, reveal: result.reveal ?? model.reveal, run: runView() };
      host.sync(model);
    }
    show({ lastAnswer: answer, result });
    return { solved: result.solved, feedback: result.feedback ?? null, message: result.message ?? '' };
  },
  probe: async (_id, payload) => {
    const result = await call('probe', { ...base(), ...instance, payload, run });
    run = result.run;
    view = result.view ?? view;
    if (model) {
      model = { ...model, run: runView(), hintsUsed: Number(run?.data?.hints ?? 0) };
      host.sync(model);
    }
    show({ lastProbe: payload, result });
    return { feedback: result.feedback ?? null, message: result.message ?? '' };
  },
  onClose: () => { model = null; host.sync(null); },
});

function show(extra: unknown = {}) {
  debug.textContent = JSON.stringify({ instance, run, ...((extra as object) ?? {}) }, null, 2);
}

async function generate() {
  const fixture = fixtureFor(kindSelect.value);
  const result = await call('generate', { ...base(), params: fixture.params, solution: fixture.solution, reveal: fixture.reveal });
  instance = { params: result.params, solution: result.solution, reveal: result.reveal };
  run = null;
  view = null;
  if (result.problems?.length) console.warn('Validation problems', result.problems);
  open(fixture);
  show({ problems: result.problems });
}

function open(fixture = fixtureFor(kindSelect.value)) {
  if (!instance) return;
  host.sync(null);
  model = {
    puzzleId: `lab-${kindSelect.value}`,
    kind: kindSelect.value,
    title: fixture.title ?? `Lab · ${kindSelect.value}`,
    prompt: fixture.prompt ?? '',
    params: instance.params,
    run: runView(),
    reveal: null,
    solved: false,
    hintsAvailable: (instance.solution?.hints ?? []).length,
    hintsUsed: 0,
  };
  host.sync(model);
}

async function init() {
  let kinds = knownPuzzleKinds();
  try {
    const server: string[] = await (await fetch('/api/dev/puzzle-lab/kinds')).json();
    kinds = [...new Set([...kinds, ...server])].sort();
  } catch { /* API not running: client kinds only */ }
  kindSelect.innerHTML = kinds.map((kind) => `<option>${kind}</option>`).join('');
  const wanted = new URLSearchParams(location.search).get('kind');
  if (wanted && kinds.includes(wanted)) kindSelect.value = wanted;
  $('lab-new').addEventListener('click', () => { void generate().catch((error) => alert(error.message)); });
  $('lab-open').addEventListener('click', () => open());
  $('lab-debug-btn').addEventListener('click', () => { debug.hidden = !debug.hidden; });
  $<HTMLInputElement>('lab-solved').addEventListener('change', (event) => {
    if (!model) return;
    model = { ...model, solved: (event.target as HTMLInputElement).checked, reveal: instance?.reveal ?? null };
    host.sync(model);
  });
  if (kinds.length) await generate().catch((error) => console.error(error));
}

void init();
