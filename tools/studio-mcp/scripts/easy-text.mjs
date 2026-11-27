import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Vision and asset jobs stay with the regular studio worker that can inspect the actual artwork.
const scriptSteps = new Set([
  'CreateStoryPreview', 'GenerateCaseSeed', 'GenerateCoreTruth', 'BuildTrueTimeline',
  'BuildOpportunityMatrix', 'GenerateCausalEvidence', 'BuildStatements', 'BuildProofGraph',
  'RepairTruthFindings', 'ReviewCaseTruthFeasibility', 'GenerateFullCaseJson', 'RepairFullCaseJson',
  'RetryFullCaseJson', 'ReviewV3PairMatrix', 'RetryIncompleteV3PairBatch', 'RepairV3SemanticLogic', 'RepairProjectionFields',
  'ReviewBlindSolvability', 'ReviewBlindSolutionMeaning',
]);
export const isScriptStep = (step) => scriptSteps.has(String(step).split(':')[0]);

function isEditorialField(schema, object, path) {
  let field = schema;
  let value = object;
  for (const segment of path) {
    if (typeof segment !== 'string' && !Number.isSafeInteger(segment)) return false;
    const key = String(segment);
    if (['__proto__', 'constructor', 'prototype'].includes(key)
      || !field || field.readOnly || Object.hasOwn(field, 'const') || Object.hasOwn(field, 'enum')
      || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) return false;
      field = field.prefixItems?.[Number(key)] ?? field.items;
    } else {
      // Compact projection schemas already omit identity fields. Legacy schemas can still declare them as strings.
      if (/^(ids?|schemaVersion|planHash|version|kind|type|correctCode)$|Ids?$/.test(key)) return false;
      field = field.properties && Object.hasOwn(field.properties, key) ? field.properties[key] : null;
    }
    value = value[key];
  }
  return field?.type === 'string' && !field.readOnly && !Object.hasOwn(field, 'const') && !Object.hasOwn(field, 'enum');
}

// The bridge validates all constraints on the merged answer before it is submitted.
export function applyEditorial(answer, required, schema) {
  const copy = JSON.parse(answer);
  const editedPaths = new Set();
  for (const edit of required) {
    if (!Array.isArray(edit?.path) || !edit.path.length || typeof edit.before !== 'string'
      || typeof edit.replacement !== 'string' || !edit.replacement.trim() || edit.replacement === edit.before
      || !isEditorialField(schema, copy, edit.path)) return null;
    const key = JSON.stringify(edit.path.map(String));
    if (editedPaths.has(key)) return null;
    editedPaths.add(key);
    const parent = fieldOwner(copy, edit.path);
    const field = edit.path.at(-1);
    if (parent[field] !== edit.before) return null;
    parent[field] = edit.replacement;
  }
  return JSON.stringify(copy);
}

async function editAnswer({ answer, schema, base, answerFile, requestId, tool, generate, saveReport }) {
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const editorial = await generate(feedback ? `${base}\nRevise your editorial patch:\n${feedback}` : base);
    let report;
    try { report = JSON.parse(editorial); } catch { feedback = 'The editorial response must be valid JSON.'; continue; }
    if (!Array.isArray(report?.required) || !Array.isArray(report?.suggestions)) {
      feedback = 'Return both required and suggestions arrays.';
      continue;
    }
    saveReport(editorial);
    if (!report.required.length) return answer;
    const patched = applyEditorial(answer, report.required, schema);
    if (patched === null) {
      feedback = 'Each required edit must replace an existing writable string with the exact original text in before. '
        + 'Put findings that require a structural change in suggestions. Revise these proposed edits:\n'
        + JSON.stringify(report.required);
      continue;
    }
    writeFileSync(answerFile, patched, 'utf8');
    const check = await tool('bridge_check', { requestId });
    if (check.valid) return patched;
    writeFileSync(answerFile, answer, 'utf8');
    feedback = 'The merged patch failed schema validation. Revise only the proposed edits below.\n'
      + JSON.stringify(report.required) + '\n' + check.errors.join('\n');
  }
  throw new Error(`Editorial patch could not be validated: ${feedback.slice(0, 700)}`);
}

function fieldOwner(object, path) {
  let parent = object;
  for (const key of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return null;
    parent = parent[key];
  }
  return parent && typeof parent === 'object' ? parent : null;
}

export function scopedRetry(answer, errors) {
  const object = JSON.parse(answer);
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
  const locations = [];
  for (const error of errors) {
    const path = error.match(/^(\$\S*?):\s/)?.[1]
      ?? error.match(/^\S+ ([\w.\[\]-]+)(?= \[ref:|:)/)?.[1];
    if (!path) continue;
    const parts = (path.startsWith('$') ? path.slice(1) : '.' + path)
      .matchAll(/\.([\w-]+)|\[(\d+)\]|\['([^']+)'\]/g);
    const keys = Array.from(parts, ([, key, index, quoted]) => key ?? index ?? quoted);
    if (keys.length === 0 || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) continue;
    const parent = fieldOwner(object, keys);
    if (!parent || (Array.isArray(parent) && !Object.hasOwn(parent, keys.at(-1)))) continue;
    locations.push({ path: keys, value: Object.hasOwn(parent, keys.at(-1)) ? parent[keys.at(-1)] : null,
      remove: error.includes('(additionalProperties)'), error });
  }
  // If an object itself is invalid, its replacement already covers any errors under it.
  return locations.sort((a, b) => a.path.length - b.path.length).filter((location, index, all) =>
    !all.slice(0, index).some(previous => previous.path.every((key, part) => key === location.path[part])));
}

export function applyScopedRetry(answer, scope, patch) {
  const original = JSON.parse(answer);
  const edits = JSON.parse(patch).edits;
  if (!Array.isArray(edits) || edits.length !== scope.length) return null;
  for (const { path, remove } of scope) {
    const edit = edits.find(edit => JSON.stringify(edit?.path) === JSON.stringify(path));
    if (!edit || (remove ? edit.remove !== true : !Object.hasOwn(edit, 'value'))) return null;
    const parent = fieldOwner(original, path);
    if (!parent) return null;
    if (remove && !Array.isArray(parent)) delete parent[path.at(-1)];
    else if (remove) return null;
    else parent[path.at(-1)] = edit.value;
  }
  return JSON.stringify(original);
}

function askCodex({ repo, executable, model, servers, images = [], effort }, prompt) {
  const args = ['--ask-for-approval', 'never', 'exec', '--ephemeral', '--json', '--sandbox', 'read-only',
    '-m', model, '-c', 'web_search="disabled"', '-c', `model_reasoning_effort="${effort}"`];
  for (const feature of ['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent']) args.push('--disable', feature);
  for (const server of servers) args.push('-c', `mcp_servers.${server}.enabled=false`);
  for (const image of images) args.push('-i', path.resolve(repo, image));
  args.push('-');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 360_000);
    let message = '', error = '', stderr = '';
    createInterface({ input: child.stdout }).on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') message = event.item.text;
      if (event.type === 'error' || event.type === 'turn.failed') error = event.error?.message || event.message || '';
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-800); });
    child.stdin.on('error', () => {}); // Early CLI failures close stdin before the full prompt is written.
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !message) return reject(new Error(`Codex (${code}): ${error || stderr || 'empty response'}`));
      resolve(message.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    });
    child.stdin.end(prompt, 'utf8');
  });
}

/** The server owns the stage contract, retries, and final gate decisions. Each model call has a fresh context. */
export async function answerTaken({ repo, taken, tool, model, executable, servers, images, log = () => {}, generate = askCodex }) {
  const { step, requestId, files } = taken;
  const read = file => readFileSync(path.resolve(repo, file), 'utf8');
  const schema = JSON.parse(read(files.schema));
  const sourcePrompt = read(files.prompt);
  const instructions = read(files.instructions).split('## Chỉ dẫn hệ thống (instructions)').at(-1);
  const base = [instructions, sourcePrompt, 'JSON schema:', JSON.stringify(schema),
    'Return only the JSON object. The runner writes the file and calls the bridge.'].join('\n');
  const options = { repo, model, executable, servers, images, effort: 'medium' };
  const needsEditor = ['CreateStoryPreview', 'GenerateFullCaseJson'].includes(step.split(':')[0]);
  const answerFile = path.resolve(repo, files.answer);
  const editorFile = path.join(path.dirname(answerFile), 'editor.json');
  const checkpointFile = path.join(path.dirname(answerFile), 'editor-checkpoint.json');
  const fingerprint = createHash('sha256').update(JSON.stringify([sourcePrompt, schema])).digest('hex');
  let cached;
  if (needsEditor && existsSync(checkpointFile)) {
    try {
      const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8'));
      if (checkpoint.fingerprint === fingerprint && typeof checkpoint.answer === 'string') cached = checkpoint;
    } catch { /* an interrupted write can leave an unreadable local checkpoint */ }
  }
  let errors = [], previous = cached?.answer ?? '', edited = cached?.edited === true;
  const saveCheckpoint = () => writeFileSync(checkpointFile, JSON.stringify({ fingerprint, answer: previous, edited }));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const scope = errors.length ? scopedRetry(previous, errors) : [];
    if (edited && errors.length && !scope.length) break;
    if (attempt !== 1 || !cached) {
      const prompt = scope.length
        ? [base, 'Correction mode overrides the output format above. Return only {"edits":[{"path":["field"],"value":...}]}.',
          'Repair exactly the listed paths. For remove:true return its path and remove:true. Preserve all other facts and IDs.',
          'Previous answer:', previous, 'Fields to repair:', JSON.stringify(scope)].join('\n')
        : errors.length ? [base, 'Previous answer:', previous, 'Correct these specific errors:', errors.join('\n')].join('\n') : base;
      const answer = await generate(options, prompt);
      try {
        if (scope.length) {
          const repaired = applyScopedRetry(previous, scope, answer);
          if (!repaired) continue;
          previous = repaired;
        } else {
          JSON.parse(answer);
          previous = answer;
        }
      } catch (error) {
        if (scope.length === 0) { previous = '{}'; errors = [error.message]; }
        continue;
      }
    }
    writeFileSync(answerFile, previous, 'utf8');
    if (needsEditor && !edited) {
      const check = await tool('bridge_check', { requestId });
      if (!check.valid) { errors = check.errors; continue; }
      saveCheckpoint();
      const order = JSON.parse(read(files.order)).order;
      const world = (order?.order ?? order)?.world;
      const guide = { HANG_DUONG_VICTORIAN: 'hang-duong', TAISHO_JAPAN: 'taisho', SHANGHAI_1930: 'thuong-hai-1930' }[world];
      previous = await editAnswer({
        answer: previous, schema, answerFile, requestId, tool,
        generate: prompt => generate({ ...options, effort: 'low' }, prompt),
        saveReport: report => writeFileSync(editorFile, report, 'utf8'),
        base: [
          read('.agents/skills/tao-vu-an/references/bien-tap-vien.md'), read('docs/case-style-guide.md'),
          guide ? read(`docs/worlds/${guide}.md`) : '', 'Case order (explicit creator and server constraints take precedence):',
          JSON.stringify(order?.order ?? order), 'Text under review:', previous,
          'The compiler owns conversation unlocks, clue access, and the hidden truth. Only block a concrete defect visible in these fields. When the defect depends on an unknown unlock condition or a hidden causal fact, record it as a suggestion. Do not re-audit solvability or demand a new proof.',
          'Return only JSON {"required":[],"suggestions":[]}. Mandatory edits may replace existing strings declared by the schema. Each edit needs path (array of exact keys or array indices), before (the complete current string), replacement and issue. Keep IDs, enums, constants and structure unchanged. Use suggestions for structural findings.',
        ].join('\n'),
      });
      edited = true;
    }
    if (needsEditor) saveCheckpoint();
    const submitted = await tool('bridge_submit', { requestId }); // Validates schema locally, then semantic constraints on server.
    if (submitted.accepted) return;
    errors = submitted.errors;
    log(`${step} · ${errors.join('\n').slice(0, 350)}`);
  }
  throw new Error(`${step}: ${errors.join('\n').slice(0, 1000)}`);
}

export async function runScriptRequest({ repo, row, env, ...options }) {
  const client = new Client({ name: 'studio-runner', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [path.join(repo, 'tools/studio-mcp/dist/src/index.js')], cwd: repo, env, stderr: 'ignore' }));
    const tool = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const data = JSON.parse(result.content[0].text);
      if (result.isError) throw new Error(`${name}: ${data.error} ${data.message}`);
      return data;
    };
    const taken = await tool('bridge_take', { requestId: row.requestId });
    try {
      await answerTaken({ repo, taken, tool, ...options });
    } catch (error) {
      await tool('bridge_release', { requestId: row.requestId }).catch(() => {});
      throw error;
    }
  } finally { await client.close(); }
}
