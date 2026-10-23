// coop-web: opt-in packet transport. Peers are engine addresses 10.77.0.1..254.
export const MAX_PACKETLEN = 1264;
import { sameGame, VERSION_FAILURE } from './coop-metadata.js';
import { validAssetPath } from './assets.js';
import { playerName } from './player-name.js';
export { sameGame, VERSION_FAILURE };

export const DIRECT_FAILURE = 'Could not connect directly. Try another network.';
// web-coop-cs phase 4: how far a player's loading is. lobby = has not started; downloaded = has every pack, waits for the
// host's game; loading = loading the map; loaded = in the host's game, has not clicked its start prompt; ready = in the
// host's game and clicked start; failed = could not load; late = the host started without this player (joins when the
// round ends); connecting = no direct link yet.
export const LOAD_STATES = ['lobby', 'downloading', 'downloaded', 'loading', 'loaded', 'ready', 'failed'];
const ROSTER_STATES = [...LOAD_STATES, 'late', 'connecting'];
const validRoster = m => typeof m.begun === 'boolean' && Number.isInteger(m.you) && Array.isArray(m.players) && m.players.length <= 4
  && m.players.every(p => p && Number.isInteger(p.peer) && p.peer >= 1 && p.peer <= 4 && ROSTER_STATES.includes(p.state)
    && Number.isInteger(p.percent) && p.percent >= 0 && p.percent <= 100 && validAssetPath(p.file));
export const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
// web-coop-relay: a relay (TURN) entry is taken only from the room's own /ice answer (coop.js), through roomIce():
// turn: / turns: URLs with a username and a credential, nothing else, never port 53 (browsers block it).
const RELAY_URL = /^turns?:[a-z0-9.-]+(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/i, STUN_URL = /^stuns?:[a-z0-9.-]+(?::\d{1,5})?$/i;
const secret = v => typeof v === 'string' && v.length > 0 && v.length <= 512;
const validRelay = s => Boolean(s) && typeof s === 'object' && Object.keys(s).every(k => ['urls', 'username', 'credential'].includes(k))
  && secret(s.username) && secret(s.credential) && Array.isArray(s.urls) && s.urls.length > 0 && s.urls.length <= 8
  && s.urls.every(u => typeof u === 'string' && RELAY_URL.test(u) && !/:53(?:\?|$)/.test(u));
const validStun = s => Boolean(s) && typeof s === 'object' && Object.keys(s).every(k => k === 'urls')
  && [].concat(s.urls).every(u => typeof u === 'string' && STUN_URL.test(u));
// The /ice answer split for rtcTransport: { iceServers: the STUN entries, relayServers: the TURN entries }. null when
// anything in it is not what that endpoint sends (the page then connects as it always did).
export function roomIce(answer) {
  const list = answer?.iceServers;
  if (!Array.isArray(list) || list.length > 6) return null;
  const relayServers = list.filter(s => s && (s.username !== undefined || s.credential !== undefined));
  const iceServers = list.filter(s => !relayServers.includes(s));
  return relayServers.length <= 2 && relayServers.every(validRelay) && iceServers.every(validStun) ? { iceServers, relayServers } : null;
}

// Config comes from the room flow (or the opt-in local test harness), never engine packets.
// relayServers: roomIce()'s TURN entries (the fallback: ICE still prefers a direct route). relayOnly: use nothing but
// the relay (the page's ?relay=1, for proving the relay; without a relay entry no connection is possible).
export function rtcTransport({ roomURL, role, hostToken, metadata, name = 'Friend', peerName, iceServers = DEFAULT_ICE,
  relayServers = [], relayOnly = false, timeoutMs = 20000, testBlockICE = false, onState = () => {} }) {
  if (!['host', 'join'].includes(role)) throw new Error('Invalid co-op role');
  for (const server of iceServers) for (const url of [].concat(server.urls))
    if (!/^stuns?:/.test(url)) throw new Error('Only direct STUN connections are supported');
  if (!Array.isArray(relayServers) || !relayServers.every(validRelay)) throw new Error('Invalid relay server');
  let self = role === 'host' ? 1 : null;
  const peers = new Map();
  const url = new URL(roomURL + '/socket', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', role);
  if (hostToken) url.searchParams.set('token', hostToken);
  const socket = new WebSocket(url);
  let stopped = false, timer, resolveReady, rejectReady, started = false;
  let queue = Promise.resolve();
  const stats = { backend: 'webrtc', state: 'waiting', sent: 0, received: 0, sentBytes: 0, receivedBytes: 0, dropped: 0, invalid: 0,
    setupSent: 0, setupReceived: 0, maxMessageSize: null, peers: {},
    ice: { stun: iceServers.length, relay: relayServers.flatMap(s => s.urls), relayOnly: relayOnly === true } };
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {}); // Hosts run while waiting; joiners await this promise.
  const state = (message, peer) => { stats.state = message; onState(message, peer); };
  const current = p => !stopped && peers.get(p.id) === p;
  function dispose(p) {
    peers.delete(p.id); delete stats.peers[p.id]; clearTimeout(p.timer); p.pc.close();
    if (p.connected) transport.onPeerLeave?.(p.id);
  }
  function stop(message) {
    if (stopped) return;
    stopped = true; clearTimeout(timer); state(message); rejectReady(new Error(message));
    for (const p of [...peers.values()]) dispose(p);
    socket.close();
  }
  const leftMessage = p => !p.connected ? DIRECT_FAILURE
    : peerName?.(p.id) ? `${peerName(p.id)} left the game.` : role === 'join' ? 'The host left the game.' : 'Your friend left the game.';
  function drop(p, message) {
    if (!current(p)) return;
    if (role === 'join') return stop(message);
    dispose(p); state(message, p.id); // The host keeps its room, engine and other friends alive.
  }
  function signal(p, message) {
    if (current(p) && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ ...message, peer: p.id, session: p.session })); ++stats.setupSent;
    }
  }
  function controlSend(p, message) {
    if (current(p) && p.control?.readyState === 'open') p.control.send(JSON.stringify(message));
  }
  // web-coop-relay: the route this link took, from getStats() (the selected candidate pair): candidate types, the
  // relay's protocol (udp / tcp / tls) and the pair's own byte and packet counters. relayed = one end is a TURN relay.
  async function path(p) {
    let found = null;
    try {
      const report = await p.pc.getStats();
      let pair;
      for (const s of report.values()) if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
      for (const s of report.values()) if (!pair && s.type === 'candidate-pair' && s.selected) pair = s; // Firefox
      const local = report.get(pair?.localCandidateId), remote = report.get(pair?.remoteCandidateId);
      if (local && remote) found = { local: local.candidateType, remote: remote.candidateType, protocol: local.protocol ?? null,
        relayProtocol: local.relayProtocol ?? null, relayed: local.candidateType === 'relay' || remote.candidateType === 'relay',
        bytesSent: pair.bytesSent ?? null, bytesReceived: pair.bytesReceived ?? null,
        packetsSent: pair.packetsSent ?? null, packetsReceived: pair.packetsReceived ?? null };
    } catch { /* no statistics: the link works without them */ }
    if (!found || !current(p) || !p.connected) return;
    const before = stats.peers[p.id].path;
    stats.peers[p.id].path = found;
    if (before?.relayed !== found.relayed) transport.onPath?.(p.id, found);
  }
  function connected(p) {
    if (!current(p) || p.connected || !p.hello || p.game?.readyState !== 'open' || p.control?.readyState !== 'open') return;
    const limit = p.pc.sctp?.maxMessageSize;
    if (limit === undefined || limit !== 0 && limit < MAX_PACKETLEN) return drop(p, DIRECT_FAILURE);
    p.connected = true; stats.peers[p.id] = { state: 'connected', maxMessageSize: limit };
    stats.maxMessageSize = limit; clearTimeout(p.timer); clearTimeout(timer); state('connected', p.id); resolveReady();
    path(p); p.pc.sctp.transport?.iceTransport?.addEventListener('selectedcandidatepairchange', () => path(p));
    if (started) controlSend(p, { type: 'start' });
  }
  function channel(p, ch) {
    if (!current(p)) { ch.close(); return; }
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'game' && !p.game && !ch.ordered && ch.maxRetransmits === 0 && ch.maxPacketLifeTime === null) {
      p.game = ch; ch.onopen = () => connected(p);
      ch.onmessage = ({ data }) => {
        if (!current(p)) return;
        if (!p.hello || !(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > MAX_PACKETLEN) { ++stats.invalid; return; }
        ++stats.received; stats.receivedBytes += data.byteLength; transport.onPacket?.(p.id, new Uint8Array(data));
      };
    } else if (ch.label === 'control' && !p.control && ch.ordered && ch.maxRetransmits === null && ch.maxPacketLifeTime === null) {
      p.control = ch;
      ch.onopen = () => { controlSend(p, { type: 'hello', metadata, name: String(name).slice(0, 32) }); connected(p); };
      ch.onmessage = ({ data }) => {
        if (!current(p)) return;
        if (typeof data !== 'string' || data.length > 4096) return drop(p, DIRECT_FAILURE);
        let message; try { message = JSON.parse(data); } catch { return drop(p, DIRECT_FAILURE); }
        if (!message || typeof message !== 'object') return drop(p, DIRECT_FAILURE);
        if (message.type === 'hello') {
          if (!sameGame(metadata, message.metadata)) return drop(p, VERSION_FAILURE);
          p.hello = true; connected(p);
        } else if (message.type === 'start' && p.hello && role === 'join') transport.onStart?.();
        else if (message.type === 'leave') drop(p, leftMessage(p));
        else if (message.type === 'progress' && p.hello && Number.isInteger(message.percent) && message.percent >= 0 && message.percent <= 100)
          transport.onProgress?.(message.percent, p.id);
        // web-coop-cs phase 4: a friend tells the host how far its loading is; the host tells every friend the room's list.
        else if (message.type === 'state' && p.hello && role === 'host' && LOAD_STATES.includes(message.state)
          && Number.isInteger(message.percent) && message.percent >= 0 && message.percent <= 100 && validAssetPath(message.file))
          transport.onPeerState?.({ state: message.state, percent: message.percent, file: message.file ?? null,
            name: playerName(message.name), message: String(message.message ?? '').slice(0, 200) }, p.id);
        else if (message.type === 'roster' && p.hello && role === 'join' && validRoster(message))
          transport.onRoster?.({ ...message, players: message.players.map(p => ({ ...p, name: playerName(p.name) })) });
        else drop(p, DIRECT_FAILURE);
      };
    } else { ch.close(); return drop(p, DIRECT_FAILURE); }
    ch.onclose = () => drop(p, leftMessage(p));
    ch.onerror = () => drop(p, DIRECT_FAILURE);
  }
  function addPeer(id, session) {
    const old = peers.get(id);
    if (old?.session === session) return old;
    if (old) dispose(old);
    const pc = new RTCPeerConnection({ iceServers: [...iceServers, ...relayServers], ...(relayOnly === true ? { iceTransportPolicy: 'relay' } : {}) });
    const p = { id, session, pc, candidates: [], connected: false, hello: false };
    peers.set(id, p); stats.peers[id] = { state: 'connecting' }; state('connecting', id);
    p.timer = setTimeout(() => drop(p, DIRECT_FAILURE), timeoutMs);
    pc.ondatachannel = ({ channel: ch }) => channel(p, ch);
    pc.onicecandidate = ({ candidate }) => { if (candidate && !testBlockICE) signal(p, { type: 'ice', candidate: candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') drop(p, DIRECT_FAILURE); };
    return p;
  }
  socket.onmessage = ({ data }) => {
    let target;
    queue = queue.then(async () => {
      if (stopped) return;
      const m = JSON.parse(data); ++stats.setupReceived;
      if (m.type === 'welcome') {
        if (!sameGame(metadata, m.metadata) || (role === 'host' ? m.peer !== 1 : m.peer < 2 || m.peer > 4)) return stop(VERSION_FAILURE);
        self = m.peer; return;
      }
      if (!Number.isInteger(m.peer) || m.peer === self || (role === 'join' ? m.peer !== 1 : m.peer < 2 || m.peer > 4)
        || typeof m.session !== 'string') return stop(DIRECT_FAILURE);
      if (m.type === 'peer') {
        if (peers.get(m.peer)?.session === m.session) return;
        const p = target = addPeer(m.peer, m.session), pc = p.pc;
        if (role === 'host') {
          channel(p, pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 }));
          channel(p, pc.createDataChannel('control'));
          const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
          signal(p, { type: 'offer', sdp: offer.sdp });
        }
        return;
      }
      const p = peers.get(m.peer);
      if (!p || p.session !== m.session) return; // Delayed setup/close from a replaced connection.
      const pc = p.pc;
      target = p;
      if (m.type === 'offer' || m.type === 'answer') {
        await pc.setRemoteDescription({ type: m.type, sdp: m.sdp });
        for (const c of p.candidates) await pc.addIceCandidate(c); p.candidates = [];
        if (m.type === 'offer') { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); signal(p, { type: 'answer', sdp: answer.sdp }); }
      } else if (m.type === 'ice' && !testBlockICE) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.candidate); else p.candidates.push(m.candidate);
      } else if (m.type === 'left') drop(p, leftMessage(p));
    }).catch(() => { if (target) drop(target, DIRECT_FAILURE); else stop(DIRECT_FAILURE); });
  };
  // A page whose direct link is up keeps its game when the room service goes away, whether the socket ends with a
  // close or with an error (a restart or a network change is an error event first).
  const linked = () => [...peers.values()].some(p => p.connected);
  socket.onerror = () => { if (!stopped && !linked()) stop(DIRECT_FAILURE); };
  // coop-web: stats.state is the LAST event of any friend. A host with a connected friend keeps playing when the
  // room service goes away (one friend failing must not make a later socket close end everyone's game).
  socket.onclose = () => { if (!stopped && !linked()) stop(DIRECT_FAILURE); };
  // coop-web: a missing host must fail even if no peer notification ever arrives.
  if (role === 'join') timer = setTimeout(() => stop(DIRECT_FAILURE), timeoutMs);
  const transport = { onPacket: null, onPeerLeave: null, onProgress: null, onStart: null, onPeerState: null, onRoster: null, onPath: null, stats, ready,
    // Reads every link's route and counters again (they are also read when a link connects or changes route).
    async paths() { await Promise.all([...peers.values()].filter(p => p.connected).map(path)); return stats.peers; },
    send(to, bytes) {
      if (!Number.isInteger(to) || to < 1 || to > 4 || to === self || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PACKETLEN) { ++stats.invalid; return; }
      const p = peers.get(to);
      if (!p?.connected || p.game.readyState !== 'open' || p.game.bufferedAmount > 256 * 1024) { ++stats.dropped; return; }
      try { p.game.send(bytes); ++stats.sent; stats.sentBytes += bytes.byteLength; } catch { ++stats.dropped; }
    },
    progress(percent) { for (const p of peers.values()) controlSend(p, { type: 'progress', percent }); },
    loadState(state, percent, message, file = null, name = '') { for (const p of peers.values()) controlSend(p, { type: 'state', state, percent, file, name, ...(message ? { message: String(message).slice(0, 200) } : {}) }); },
    roster(players, begun) { if (role === 'host') for (const p of peers.values()) controlSend(p, { type: 'roster', players, begun, you: p.id }); },
    start() { if (role === 'host') { started = true; for (const p of peers.values()) controlSend(p, { type: 'start' }); } },
    close() {
      for (const p of peers.values()) controlSend(p, { type: 'leave' });
      // Error UI can synchronously stop its engine inside onState; retain the useful failure.
      stop(['waiting', 'connecting', 'connected'].includes(stats.state) ? 'closed' : stats.state);
    },
  };
  return transport;
}

export function broadcastTransport(room, self) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room) || !Number.isInteger(self) || self < 1 || self > 254)
    throw new Error('Invalid local co-op room or peer');
  const channel = new BroadcastChannel(`kisak-coop-${room}`);
  const transport = {
    onPacket: null,
    send(peer, bytes) { channel.postMessage({ from: self, to: peer, bytes }); },
    close() { channel.close(); },
  };
  channel.onmessage = ({ data }) => {
    if (data?.to !== self || !Number.isInteger(data.from) || data.from < 1 || data.from > 254 || data.from === self
      || !(data.bytes instanceof Uint8Array) || !data.bytes.length || data.bytes.length > MAX_PACKETLEN) return;
    transport.onPacket?.(data.from, data.bytes);
  };
  return transport;
}

// coop-web: test-only link shaping. Only a test sets globalThis.__kisakNetShim (before the page loads); the site never does.
// Each side delays what it sends, so the round trip is 2 x delayMs; loss applies per direction.
function shaped(transport, { delayMs = 0, lossPercent = 0 }) {
  const send = transport.send.bind(transport), shim = { delayMs, lossPercent, lost: 0, passed: 0 };
  if (transport.stats) transport.stats.shim = shim;
  transport.send = (to, bytes) => {
    if (Math.random() * 100 < lossPercent) { ++shim.lost; return; }
    ++shim.passed; setTimeout(() => send(to, bytes), delayMs);
  };
}

export function attachNet(module, transport) {
  if (globalThis.__kisakNetShim) shaped(transport, globalThis.__kisakNetShim);
  if (!module._KB_NetInit) throw new Error('This engine has no browser co-op transport');
  const buffer = module.HEAPF32.buffer;
  const [version, slots, max, stride, rx, tx, offset] = new Uint32Array(buffer, module._KB_NetInit(), 9);
  if (version !== 1 || max !== MAX_PACKETLEN || stride !== max + 8 || (slots & (slots - 1)))
    throw new Error('Incompatible browser packet ring');
  const incoming = new Uint32Array(buffer, rx, 3), outgoing = new Uint32Array(buffer, tx, 3);
  const stats = { sent: 0, received: 0, invalid: 0, get rxDropped() { return Atomics.load(incoming, 2); },
    get txDropped() { return Atomics.load(outgoing, 2); } };
  transport.onPeerLeave = peer => module._KB_NetPeerLeft?.(peer);
  transport.onPacket = (peer, bytes) => {
    if (!Number.isInteger(peer) || peer < 1 || peer > 254 || !(bytes instanceof Uint8Array)
      || !bytes.length || bytes.length > max) { ++stats.invalid; return; }
    const write = Atomics.load(incoming, 1);
    if (((write - Atomics.load(incoming, 0)) >>> 0) >= slots) { Atomics.add(incoming, 2, 1); return; }
    const at = rx + offset + (write & (slots - 1)) * stride;
    new Uint32Array(buffer, at, 2).set([peer, bytes.length]);
    new Uint8Array(buffer, at + 8, bytes.length).set(bytes);
    Atomics.store(incoming, 1, (write + 1) >>> 0); ++stats.received;
  };
  module.kisakNetDrain = () => {
    try {
      let read = Atomics.load(outgoing, 0);
      const write = Atomics.load(outgoing, 1);
      while (read !== write) {
        const at = tx + offset + (read & (slots - 1)) * stride;
        const [peer, length] = new Uint32Array(buffer, at, 2);
        if (peer >= 1 && peer <= 254 && length > 0 && length <= max) {
          transport.send(peer, new Uint8Array(buffer, at + 8, length).slice()); ++stats.sent;
        } else ++stats.invalid;
        read = (read + 1) >>> 0;
        Atomics.store(outgoing, 0, read);
      }
    } finally { module._KB_NetDrained(); }
  };
  return { stats, close() { transport.onPacket = null; transport.onPeerLeave = null; module.kisakNetDrain = () => module._KB_NetDrained(); transport.close(); } };
}
