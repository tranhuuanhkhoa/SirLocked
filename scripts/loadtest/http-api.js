import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, prepareUsers, userForVu, freshToken } from './lib/auth.js';

const selected = __ENV.SCENARIO || 'smoke';
const vus = Number(__ENV.VUS || 50);
const maxVus = Number(__ENV.MAX_VUS || 200);
const loginLatency = new Trend('auth_login_latency', true);
const readPaths = ['/api/auth/me', '/api/cases/published', '/api/progress/me', '/api/market/catalog', '/api/workshop/weekly/case-of-week'];
const scenarioStages = count => [{ duration: '1m', target: Math.ceil(count / 2) }, { duration: '1m', target: count }, { duration: '3m', target: count }];
const scenarios = {
  smoke: { executor: 'constant-vus', vus: 1, duration: '30s' },
  load: { executor: 'ramping-vus', startVUs: 1, stages: scenarioStages(vus) },
  stress: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '1m', target: 50 }, { duration: '1m', target: 100 }, { duration: '1m', target: 150 }, { duration: '2m', target: maxVus }] },
  auth: { executor: 'constant-arrival-rate', rate: 4, timeUnit: '1m', duration: '5m', preAllocatedVUs: 1, maxVUs: 1, exec: 'auth' },
};
if (!scenarios[selected]) throw new Error('SCENARIO must be smoke, load, stress, or auth.');
const userCount = selected === 'smoke' || selected === 'auth' ? 1 : selected === 'load' ? vus : maxVus;

export const options = {
  scenarios: { selected: scenarios[selected] },
  summaryTrendStats: ['min', 'med', 'avg', 'max', 'p(50)', 'p(95)', 'p(99)'],
  thresholds: {
    ...(selected === 'auth' ? {} : { 'http_req_duration{kind:api}': ['p(95)<500'] }),
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  return { users: prepareUsers(userCount) };
}

export default function (data) {
  const user = userForVu(data);
  const path = readPaths[Math.floor(Math.random() * readPaths.length)];
  const response = http.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${freshToken(user)}` },
    tags: { kind: 'api' },
  });
  check(response, { [`${path} returns 200`]: r => r.status === 200 });
  sleep(1);
}

export function auth(data) {
  const user = userForVu(data);
  const started = Date.now();
  const response = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email: user.email, password: user.password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { kind: 'auth' },
  });
  loginLatency.add(Date.now() - started);
  check(response, { 'login within auth scenario succeeds': r => r.status === 200 });
}

export function handleSummary(data) {
  const values = name => data.metrics[name]?.values || {};
  const api = values('http_req_duration{kind:api}');
  const auth = values('auth_login_latency');
  const failures = values('http_req_failed').rate;
  const vusMax = values('vus_max').max;
  const text = [
    `HTTP API scenario: ${selected}`,
    `API duration p50/p95/p99: ${api['p(50)'] ?? 'n/a'} / ${api['p(95)'] ?? 'n/a'} / ${api['p(99)'] ?? 'n/a'} ms`,
    `Login duration p50/p95/p99: ${auth['p(50)'] ?? 'n/a'} / ${auth['p(95)'] ?? 'n/a'} / ${auth['p(99)'] ?? 'n/a'} ms`,
    `RPS: ${values('http_reqs').rate ?? 'n/a'}`,
    `HTTP error %: ${failures === undefined ? 'n/a' : (failures * 100).toFixed(3)}`,
    `Max VUs: ${vusMax ?? 'n/a'}`,
  ].join('\n');
  const dir = __ENV.RESULTS_DIR || '/home/ubuntu/reports/loadtest/results';
  return {
    [`${dir}/http-api-${selected}.json`]: JSON.stringify(data, null, 2),
    [`${dir}/http-api-${selected}.txt`]: `${text}\n`,
    stdout: `${text}\n`,
  };
}
