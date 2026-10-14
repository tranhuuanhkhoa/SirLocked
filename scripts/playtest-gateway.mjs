import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const cookieName = 'sirlocked_playtest';
const sessionSeconds = 12 * 60 * 60;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const allowedAuth = new Set(['/api/auth/login', '/api/auth/refresh', '/api/auth/me', '/api/auth/logout']);

export function playerApiAllowed(name) {
  return allowedAuth.has(name) || /^\/api\/(cases|rooms|game\/rooms|profile|workshop|weekly)(\/|$)/.test(name)
    || /^\/hubs\/game(\/|$)/.test(name);
}
export function sameSecret(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signSession(secret, expires) {
  const stamp = String(expires);
  return `${stamp}.${createHmac('sha256', secret).update(stamp).digest('hex')}`;
}
export function validSession(secret, cookie, now = Math.floor(Date.now() / 1000)) {
  const parts = (cookie || '').split('.');
  const expiry = Number(parts[0]);
  return parts.length === 2 && Number.isSafeInteger(expiry) && expiry > now
    && expiry <= now + sessionSeconds && sameSecret(cookie, signSession(secret, expiry));
}
function cookieValue(request) {
  return (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
function requestPath(request) {
  const result = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (result.includes('\\') || result.includes('\0') || result.split('/').includes('..')) throw new Error('Invalid path');
  return result;
}
function originAllowed(request) {
  if (!request.headers.origin) return true;
  try { return new URL(request.headers.origin).host === request.headers.host; } catch { return false; }
}
function respond(response, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', ...extra });
  response.end(body);
}
const accessPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SirLocked playtest</title><style>body{background:#151b20;color:#eee;font:18px system-ui;max-width:480px;margin:12vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin-top:16px}button{background:#e4c278;border:0}p{line-height:1.6}</style><h1>SirLocked playtest</h1><p>Enter the access password provided by your facilitator. Then sign in with your assigned detective account.</p><p>Nhập mật khẩu truy cập do người điều phối cung cấp, sau đó đăng nhập tài khoản thám tử được cấp.</p><form method="post" action="/playtest/access"><label>Access password / Mật khẩu truy cập<input name="password" type="password" required autocomplete="current-password" maxlength="128"></label><button>Enter playtest</button></form></html>`;

export async function createGateway({ root, apiPort, secret, accessPassword, port = 0 }) {
  if (secret.length < 32 || accessPassword.length < 20) throw new Error('Strong playtest credentials required.');
  const publicRoot = await fs.realpath(root);
  const attempts = new Map();
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      const name = requestPath(request);
      if (name === '/playtest/access') {
        if (request.method === 'GET') return respond(response, 200, accessPage, 'text/html; charset=utf-8');
        if (request.method !== 'POST' || !originAllowed(request)) return respond(response, 403, 'Forbidden');
        const identity = request.headers['cf-connecting-ip'] || request.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const entry = attempts.get(identity) || { count: 0, until: now + 60000 };
        attempts.set(identity, entry);
        if (++entry.count > 10 || attempts.size > 10000) return respond(response, 429, 'Try again in one minute.');
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 1024) return respond(response, 413, 'Too large'); chunks.push(chunk); }
        const supplied = new URLSearchParams(Buffer.concat(chunks).toString()).get('password');
        if (!sameSecret(supplied, accessPassword)) return respond(response, 401, 'Incorrect access password.');
        const cookie = signSession(secret, Math.floor(Date.now() / 1000) + sessionSeconds);
        const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        return respond(response, 303, '', 'text/plain', { Location: '/#/menu', 'Set-Cookie': `${cookieName}=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionSeconds}${secure}` });
      }
      if (!validSession(secret, cookieValue(request))) {
        if (name.startsWith('/api/') || name.startsWith('/hubs/')) return respond(response, 401, '{"success":false,"message":"Playtest access required."}', 'application/json');
        return respond(response, 303, '', 'text/plain', { Location: '/playtest/access' });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !originAllowed(request)) return respond(response, 403, 'Forbidden');
      if (name.startsWith('/api/') || name.startsWith('/hubs/')) {
        if (!playerApiAllowed(name)) return respond(response, 404, 'Not found');
        if (Number(request.headers['content-length'] || 0) > 8 * 1024 * 1024) return respond(response, 413, 'Too large');
        const headers = { ...request.headers, host: `127.0.0.1:${apiPort}` };
        delete headers.cookie;
        delete headers['x-forwarded-for']; delete headers['x-forwarded-proto'];
        const clientIp = request.headers['cf-connecting-ip'];
        headers['x-forwarded-for'] = typeof clientIp === 'string' && isIP(clientIp) ? clientIp : request.socket.remoteAddress;
        const upstream = http.request({ host: '127.0.0.1', port: apiPort, path: request.url, method: request.method, headers }, incoming => {
          response.writeHead(incoming.statusCode, { ...incoming.headers, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
          incoming.pipe(response);
        });
        upstream.on('error', () => { if (!response.headersSent) respond(response, 502, 'API unavailable'); else response.destroy(); });
        upstream.setTimeout(120000, () => upstream.destroy());
        let bytes = 0;
        request.on('data', data => { bytes += data.length; if (bytes > 8 * 1024 * 1024) { upstream.destroy(); if (!response.headersSent) respond(response, 413, 'Too large'); } });
        request.pipe(upstream); response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return respond(response, 405, 'Method not allowed');
      const relative = name === '/' ? 'index.html' : name.replace(/^\/+/, '');
      const ext = path.extname(relative).toLowerCase();
      if (!mime[ext] || relative.split('/').some(x => x.startsWith('.'))) return respond(response, 404, 'Not found');
      const target = await fs.realpath(path.join(publicRoot, relative));
      if (!target.startsWith(publicRoot + path.sep)) return respond(response, 404, 'Not found');
      const data = await fs.readFile(target);
      respond(response, 200, request.method === 'HEAD' ? '' : data, mime[ext]);
    } catch (error) {
      if (!response.headersSent) respond(response, error.code === 'ENOENT' ? 404 : 400, 'Request unavailable');
      else response.destroy();
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => {
    let name; try { name = requestPath(request); } catch { socket.destroy(); return; }
    if (name !== '/hubs/game' || !validSession(secret, cookieValue(request)) || !originAllowed(request)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${apiPort}` };
    delete headers.cookie; delete headers['x-forwarded-for']; delete headers['x-forwarded-proto'];
    const clientIp = request.headers['cf-connecting-ip'];
    headers['x-forwarded-for'] = typeof clientIp === 'string' && isIP(clientIp) ? clientIp : request.socket.remoteAddress;
    const upstream = http.request({ host: '127.0.0.1', port: apiPort, path: request.url, method: 'GET', headers });
    upstream.on('upgrade', (incoming, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n` + Object.entries(incoming.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
      socket.pipe(remote).pipe(socket);
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
    });
    upstream.on('response', incoming => { incoming.resume(); socket.end(`HTTP/1.1 ${incoming.statusCode} Rejected\r\nConnection: close\r\n\r\n`); });
    upstream.on('error', () => socket.destroy()); upstream.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, port: server.address().port, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const gateway = await createGateway(config);
  console.log(`Frozen playtest gateway ready on loopback port ${gateway.port}.`);
}
