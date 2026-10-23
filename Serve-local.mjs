// Host the BO1Z mirror on this machine: http://127.0.0.1:1000/bsz — the same path scheme as vel.gg/bsz.
//
// Serves the folder this file is in (the site root: index.html, the ten map pages, artifacts/ and the map
// packs) under /bsz, plus the /bsz/rooms co-op signalling service the multiplayer lobby talks to. One file,
// Node 18+, no dependencies, nothing to install:
//
//   node Serve-local.mjs      // this machine only (127.0.0.1)
//   node Serve-wan.mjs        // all interfaces: friends on the LAN or over the internet (open/forward TCP 1000)
//
// The /bo1z prefix answers too, for links saved before the rename.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1'; // Serve-wan.mjs sets '0.0.0.0' for LAN/internet hosting
const PORT = 1000;
const PREFIX = '/bsz'; // what the pages advertise (<base href>) and vel.gg uses
const ALIAS = '/bo1z'; // older links still answer
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHUNK = 8 * 1024 * 1024; // per-map override comes from manifest.json transport.chunk

const MAPS = {
  five: 'zombie_pentagon', kino: 'zombie_theater', riese: 'zombie_cod5_factory',
  nacht: 'zombie_cod5_prototype', verruckt: 'zombie_cod5_asylum', shinonuma: 'zombie_cod5_sumpf',
  ascension: 'zombie_cosmodrome', cotd: 'zombie_coast', shangrila: 'zombie_temple', moon: 'zombie_moon',
};
const PAGES = new Set([...Object.keys(MAPS), 'bo1zm']);
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webm': 'video/webm',
  '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.gsc': 'text/plain', '.cfg': 'text/plain',
};
const BLOCKED = [/\.partial$/, /\.tmp$/, /\/web-manifest-horde\.json$/, /-horde\.html$/];
const SEC = {
  'Cross-Origin-Opener-Policy': 'same-origin', // cross-origin isolation: the engine needs SharedArrayBuffer
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function writeHead(res, status, headers = {}) {
  res.writeHead(status, { ...SEC, ...headers });
}

function text(res, status, message) {
  const body = Buffer.from(message);
  writeHead(res, status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(req_isHead(res) ? undefined : body);
}

function req_isHead(res) { return res.req?.method === 'HEAD'; }

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  writeHead(res, status, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(req_isHead(res) ? undefined : body);
}

// One byte range only, like kino_mirror.py: bytes=a-b, bytes=a- and suffix bytes=-b.
function parseRange(value, size) {
  if (!value.startsWith('bytes=') || value.includes(',')) throw new RangeError('Only one byte range');
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new RangeError('Invalid range');
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!(suffix > 0)) throw new RangeError('Invalid suffix range');
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!(start < size) || start > end) throw new RangeError('Unsatisfiable range');
  return [start, end];
}

const chunkCache = new Map();
function manifestChunk(slug) {
  if (chunkCache.has(slug)) return chunkCache.get(slug);
  let chunk = null;
  try {
    const file = slug === 'five' ? path.join(ROOT, 'manifest.json') : path.join(ROOT, slug, 'manifest.json');
    chunk = Number(JSON.parse(fs.readFileSync(file, 'utf8')).transport.chunk);
    if (!Number.isInteger(chunk) || chunk <= 0) chunk = null;
  } catch { chunk = null; }
  chunkCache.set(slug, chunk);
  return chunk;
}

// ---------------------------------------------------------------------------------------------------------------------
// /bsz/rooms — the co-op lobby signalling service (same protocol as the live site's Worker)
// ---------------------------------------------------------------------------------------------------------------------
const MAX_PEERS = 4;
const ROOM_TTL = 6 * 3600 * 1000;
const ROOM_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const ROOM_PATH = /^\/(?:bsz|bo1z)\/rooms(?=\/|$)/;
const rooms = new Map(); // code -> { metadata, hostToken, createdAt, peers: Map(peer -> {session, socket, ...}) }

function roomCode() {
  // The lobby's invite check is /^[A-Z2-9]{8}$/ (coop.js): eight characters, no I/O/0/1.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (code.length < 8) code += alphabet[crypto.randomBytes(1)[0] % alphabet.length];
  return code;
}

function roomCreate(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 64 * 1024) req.destroy();
  });
  req.on('end', () => {
    if (req.destroyed || res.writableEnded) return;
    let metadata;
    try {
      metadata = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid room metadata' });
      return;
    }
    const now = Date.now();
    for (const [code, room] of rooms)
      if (now - room.createdAt > ROOM_TTL && !room.peers.size) rooms.delete(code);
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const room = { metadata, hostToken: crypto.randomBytes(16).toString('hex'), createdAt: Date.now(), peers: new Map() };
    rooms.set(code, room);
    json(res, 200, { code, hostToken: room.hostToken, createdAt: room.createdAt });
  });
  req.on('error', () => {});
}

function roomsHttp(req, res) {
  const match = ROOM_PATH.exec(new URL(req.url, 'http://localhost').pathname);
  if (!match) return false;
  const rest = new URL(req.url, 'http://localhost').pathname.slice(match[0].length).replace(/^\/+|\/+$/g, '');
  if (req.method === 'POST' && !rest) {
    roomCreate(req, res);
  } else if (req.method === 'GET' && rest && rest.endsWith('/ice')) {
    json(res, 200, { iceServers: ROOM_ICE });
  } else if (req.method === 'GET' && rest && !rest.endsWith('/socket')) {
    const room = rooms.get(rest);
    if (!room) json(res, 404, { error: 'That room does not exist.' });
    else json(res, 200, room.metadata);
  } else if (req.method === 'GET' && rest.endsWith('/socket')) {
    json(res, 400, { error: 'Not a WebSocket request' }); // real socket requests arrive via the upgrade event
  } else {
    json(res, 405, { error: 'Unsupported room request' });
  }
  return true;
}

function wsSend(info, payload) {
  try {
    wsRaw(info, 0x1, Buffer.from(JSON.stringify(payload)));
  } catch { /* a dying peer is cleaned up by its close event */ }
}

function wsRaw(info, opcode, payload) {
  const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (payload.length < 126) header[1] = payload.length;
  else if (payload.length < 65536) {
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  info.socket.write(Buffer.concat([header, payload]));
}

// Parse buffered client frames; browsers always mask. Handles ping/pong, close, and fragmented text.
function wsFeed(code, info, chunk) {
  info.buffer = info.buffer.length ? Buffer.concat([info.buffer, chunk]) : chunk;
  for (;;) {
    const buf = info.buffer;
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    const fin = (buf[0] & 0x80) !== 0;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return;
      const big = buf.readBigUInt64BE(2);
      if (big > 1048576n) { info.socket.destroy(); return; }
      length = Number(big);
      offset = 10;
    }
    if (length > 1048576) { info.socket.destroy(); return; }
    const maskEnd = offset + (masked ? 4 : 0);
    if (buf.length < maskEnd + length) return;
    let payload = buf.subarray(maskEnd, maskEnd + length);
    if (masked) {
      const mask = buf.subarray(offset, maskEnd);
      const out = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    info.buffer = buf.subarray(maskEnd + length);
    if (opcode === 0x8) { // close
      try { wsRaw(info, 0x8, Buffer.alloc(0)); } catch { /* already gone */ }
      info.socket.end();
      wsLeave(code, info);
      return;
    }
    if (opcode === 0x9) { // ping
      try { wsRaw(info, 0xA, payload); } catch { /* already gone */ }
      continue;
    }
    if (opcode !== 0x1 && opcode !== 0x0) continue; // binary/pong: ignored
    info.fragments = info.fragments ? Buffer.concat([info.fragments, payload]) : payload;
    if (!fin) continue;
    const message = info.fragments.toString('utf8');
    info.fragments = null;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      continue;
    }
    const target = data?.peer;
    if (!Number.isInteger(target) || target === info.peer) continue;
    const room = rooms.get(code);
    const receiver = room?.peers.get(target);
    if (!receiver) continue;
    data.peer = info.peer; // the relay replaces peer/session with the sender's own (net.js matches on these)
    data.session = info.session;
    wsSend(receiver, data);
  }
}

function wsLeave(code, info) {
  const room = rooms.get(code);
  if (!room || room.peers.get(info.peer) !== info) return;
  room.peers.delete(info.peer);
  if (!room.peers.size) {
    rooms.delete(code);
    return;
  }
  for (const other of room.peers.values()) wsSend(other, { type: 'left', peer: info.peer, session: info.session });
}

function jsonSocket(socket, status, payload) {
  const body = JSON.stringify(payload);
  socket.end(`HTTP/1.1 ${status} Error\r\nContent-Type: application/json\r\n`
    + `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Static site
// ---------------------------------------------------------------------------------------------------------------------
function staticFile(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return text(res, 404, 'Not found');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return text(res, 404, 'Not found');
  }
  if (pathname === '' || pathname === '/') {
    writeHead(res, 302, { Location: `${PREFIX}/`, 'Content-Length': 0 });
    return res.end();
  }
  let rel;
  if (pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)) rel = pathname.slice(PREFIX.length);
  else if (pathname === ALIAS || pathname.startsWith(`${ALIAS}/`)) rel = pathname.slice(ALIAS.length);
  else return text(res, 404, 'Not found');
  let relPath = rel.replace(/\/+$/, '').replace(/^\/+/, '');
  if (!relPath) relPath = 'index.html';
  else if (!relPath.includes('/') && PAGES.has(relPath)) relPath += '.html'; // /bsz/kino serves kino.html
  let part = null;
  const pack = Object.keys(MAPS).find(slug => relPath.startsWith(slug === 'five' ? 'pack/' : `${slug}/pack/`));
  const objectPart = pack ? /^(.+)\.br\/(\d{1,10})$/.exec(relPath) : null;
  if (objectPart) { // the CDN's <file>.br/<k> spelling: serve that slice of the whole file
    [relPath, part] = [objectPart[1], Number(objectPart[2])];
  }
  if (url.searchParams.has('part')) {
    const value = url.searchParams.get('part');
    if (part !== null || !pack || !/^\d{1,10}$/.test(value)) return text(res, 400, 'Invalid part');
    part = Number(value);
  }
  if (relPath.split('/').some(segment => segment.startsWith('.')) || BLOCKED.some(pattern => pattern.test(`/${relPath}`))) {
    return text(res, 404, 'Not a public asset');
  }
  const target = path.resolve(ROOT, relPath);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return text(res, 404, 'Not found');
  let fullSize;
  try {
    fullSize = fs.statSync(target).size;
    if (!fs.statSync(target).isFile()) return text(res, 404, 'Offline asset not found');
  } catch {
    return text(res, 404, 'Offline asset not found');
  }
  let baseOffset = 0;
  let size = fullSize;
  if (part !== null) {
    const chunk = manifestChunk(pack);
    if (!chunk) return text(res, 404, 'Offline map manifest not found or invalid');
    baseOffset = part * chunk;
    if (baseOffset >= fullSize) return text(res, 404, 'Offline chunk not found');
    size = Math.min(chunk, fullSize - baseOffset);
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (req.headers.range) {
    try {
      [start, end] = parseRange(req.headers.range, size);
    } catch {
      writeHead(res, 416, { 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      return res.end();
    }
    status = 206;
  }
  const headers = {
    'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': Math.max(0, end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  writeHead(res, status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(target, { start: baseOffset + start, end: baseOffset + end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    if (roomsHttp(req, res)) return;
    if (req.method === 'GET' || req.method === 'HEAD') return staticFile(req, res);
    text(res, 404, 'Not found');
  } catch (error) {
    if (!res.headersSent) text(res, 500, 'Internal error');
    else res.destroy();
    console.error('HTTP', req.method, req.url, error?.message ?? error);
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const code = url.pathname.slice(match[0].length).replace(/^\/+|\/+$/g, '').split('/')[0];
    const role = url.searchParams.get('role');
    const token = url.searchParams.get('token') ?? '';
    if (role !== 'host' && role !== 'join') return jsonSocket(socket, 400, { error: 'Invalid role' });
    const room = rooms.get(code);
    if (!room) return jsonSocket(socket, 404, { error: 'That room does not exist.' });
    let peer;
    if (role === 'host') {
      if (token !== room.hostToken || room.peers.has(1)) return jsonSocket(socket, 403, { error: 'That room is already hosted.' });
      peer = 1;
    } else {
      let free = null;
      for (let n = 2; n <= MAX_PEERS; n++) if (!room.peers.has(n)) { free = n; break; }
      if (free === null) return jsonSocket(socket, 409, { error: 'That room is full.' });
      peer = free;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      return jsonSocket(socket, 400, { error: 'Not a WebSocket request' });
    }
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const info = { peer, session: crypto.randomBytes(8).toString('hex'), socket, buffer: Buffer.alloc(0), fragments: null };
    room.peers.set(peer, info);
    socket.on('data', chunk => wsFeed(code, info, chunk));
    socket.on('error', () => socket.destroy());
    // A plain TCP close (no WebSocket close frame) only fires 'end' on an upgraded socket — Node keeps the
    // writable side open and 'close' never comes. wsLeave is idempotent, so both events can call it.
    socket.on('end', () => { wsLeave(code, info); socket.end(); });
    socket.on('close', () => wsLeave(code, info));
    wsSend(info, { type: 'welcome', peer, metadata: room.metadata });
    for (const [other, otherInfo] of room.peers) {
      if (other === peer) continue;
      wsSend(info, { type: 'peer', peer: other, session: otherInfo.session });
      wsSend(otherInfo, { type: 'peer', peer, session: info.session });
    }
    if (head.length) wsFeed(code, info, head);
  } catch {
    socket.destroy();
  }
});

server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

function lanIps() {
  const addresses = new Set();
  for (const list of Object.values(os.networkInterfaces()))
    for (const net of list ?? [])
      if (net.family === 'IPv4' && !net.internal) addresses.add(net.address);
  return [...addresses].sort();
}

server.listen(PORT, HOST, () => {
  console.log('BO1Z mirror online:');
  console.log(`  http://127.0.0.1:${PORT}${PREFIX}`);
  if (HOST === '0.0.0.0') {
    for (const ip of lanIps()) console.log(`  http://${ip}:${PORT}${PREFIX}   (friends on your network)`);
    console.log('Internet play: forward TCP port 1000 to this machine, then share http://<your-public-ip>:1000/bsz');
  }
  console.log('Ctrl+C to stop.');
});
