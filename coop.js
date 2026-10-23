// coop-web: room identity and map selection MUST precede imports of maps.js/play.js.
// web-coop-lobby: the entry point of every /bo1zm map page. It first settles the MODE (single player: play.js alone,
// no room, nothing of co-op; multiplayer: the lobby below), then, in multiplayer, shows the lobby as a screen of its
// own from the moment a room exists until this page has presented a real frame of the running match.
import { hostMetadata, roomSelection } from './coop-metadata.js';
import { rtcTransport, roomIce, DIRECT_FAILURE } from './net.js';
import { CS_MOD, csLabel } from './guns.js';
import { assetDescription } from './assets.js';
import { playerName } from './player-name.js';
import { choiceScreen, savedChoices, rememberChoices } from './choice-screen.js';
import { mapRules } from './choices.js';
import { leaveGuard } from './leave-guard.js';

const base = new URL('./', import.meta.url), $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search), code = query.get('room');
let mode = code ? 'multi' : null;
const panel = document.createElement('aside');
panel.id = 'coop-lobby';
panel.innerHTML = '<div class="card"><h1 id="coop-title"></h1><p id="coop-map"></p>'
  + '<div id="coop-name-field" hidden><label for="coop-name">Your name</label>'
  + '<input id="coop-name" maxlength="16" autocomplete="nickname" spellcheck="false" aria-describedby="coop-name-help">'
  + '<small id="coop-name-help">Up to 16 letters, numbers, spaces or . _ \' ! -</small></div>'
  + '<p id="coop-guns-room" hidden></p>'
  // web-coop-keys: the page's Fullscreen option (play.js Options, which the lobby covers), with what it buys.
  + '<label id="coop-fullscreen" hidden><input id="coop-fullscreen-box" type="checkbox"> Fullscreen'
  + '<small>In fullscreen, Ctrl+W and other browser shortcuts go to the game (Chrome, Edge).</small></label>'
  + '<div id="coop-invite" hidden><label for="coop-link">Invite link</label>'
  + '<div class="link"><input id="coop-link" readonly><button type="button" id="coop-copy" class="option">Copy link</button></div></div>'
  // One row per player with its loading state (and the host's small "Start without <name>").
  + '<ul id="coop-friends" aria-label="Players in the lobby" hidden></ul>'
  + '<p id="coop-failure" role="alert" hidden></p>'
  + '<p id="coop-status" role="status" aria-live="polite"></p>'
  + '<p id="coop-relay" hidden></p>' // web-coop-relay: "Relayed connection" when a link goes through the relay
  + '<button type="button" id="coop-go" class="option go" hidden></button><p id="coop-reason"></p></div>';
document.body.append(panel);
const css = document.createElement('link');
css.rel = 'stylesheet'; css.href = new URL('coop.css', base); document.head.append(css);
const show = message => { $('coop-status').textContent = message; };
const stage = name => { panel.dataset.stage = name; };
// Something small and permanent that tells the mode apart while playing: a corner label and the page title.
// (user, 2026-10-16: "remove the single player multiplayer text in the top left corner": the label stays in the page,
// hidden, for the tests that read the mode from it; nothing shows.)
function modeLabel(text) {
  const label = document.createElement('p');
  label.id = 'coop-mode-label'; label.textContent = text; label.hidden = true; document.body.append(label);
  document.title += ' · ' + text;
}
async function json(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Could not open the room.');
  return value;
}
function failure(error) {
  const message = error.message || DIRECT_FAILURE;
  leaveGuard.disarm('error'); // web-coop-keys: nothing to lose behind the error screen
  show(message);
  document.body.classList.add('coop-error'); // the lobby steps aside: the page's own error screen is below it
  if (window.five) window.five.onCoopError?.(message);
  else {
    $('error-message').textContent = message; $('error-message').hidden = false;
    $('play').textContent = code ? 'Rejoin' : 'Reload'; $('play').disabled = false; $('play').hidden = false;
    $('play').onclick = () => { leaveGuard.leave(); location.reload(); };
  }
}
try {
  stage('connecting');
  $('coop-title').textContent = code ? 'Multiplayer lobby' : 'Choose your game';
  show(code ? 'Connecting to the host' : '');
  const [build, config] = await Promise.all([json(new URL('coop-build.json', base)), json(new URL('coop-config.json', base))]);
  const roomsURL = new URL(config.roomsURL, location.href).href.replace(/\/$/, '');
  const gunsLabel = zone => csLabel(build.maps.find(m => m.zone === zone)?.normal?.csLooks === true);
  let lobby = null, guns = 'normal';
  if (!code) {
    const { map, horde } = await import('./maps.js');
    const offered = build.maps.find(m => m.zone === map.zone);
    let choice = savedChoices(query);
    if (globalThis.__kisakLandingPick) choice = { mode: globalThis.__kisakMode, guns: globalThis.__kisakGuns === 'cs' ? 'cs' : 'classic', explicit: true };
    const rule = mapRules(choice.guns, offered, horde);
    if (!choice.explicit || !rule.allowed || horde && choice.guns === 'cs') {
      panel.hidden = true;
      choice = await new Promise(resolve => {
        const view = choiceScreen({ choice, map: { ...offered, name: map.name }, horde, onContinue: value => { view.screen.remove(); resolve(value); } });
      });
      panel.hidden = false;
    }
    rememberChoices(choice);
    mode = choice.mode; guns = choice.guns === 'cs' ? 'cs' : 'normal';
    $('coop-map').textContent = map.name + (horde ? ' \u00b7 Hell mode' : '');
    const chosenURL = new URL(location.href); chosenURL.searchParams.set('mode', mode); chosenURL.searchParams.set('guns', choice.guns);
    history.replaceState(null, '', chosenURL);
    $('coop-guns-room').textContent = 'Guns: ' + (guns === 'cs' ? gunsLabel(map.zone) : 'Classic'); $('coop-guns-room').hidden = false;
  }
  if (mode === 'single') {
    // Single player: play.js exactly as on a page without co-op. No lobby object, no room, no transport.
    modeLabel('Single player');
    globalThis.__kisakGuns = guns;
    globalThis.__kisakLandingPick = true;
    // The name from GAME SETUP (validated; '' = none): engine.js starts the game with it, so the scoreboard shows it.
    try { globalThis.__kisakPlayerName = playerName(localStorage.getItem('bo1zm-player-name')); } catch { globalThis.__kisakPlayerName = ''; }
    panel.remove();
    await import('./play.js');
  } else {
  delete globalThis.__kisakLandingPick;
  globalThis.__kisakNoIntro = true; // no intro / loading video in multiplayer: the lobby is the loading screen
  modeLabel('Multiplayer'); stage('connecting');
  $('coop-title').textContent = code ? 'Multiplayer lobby' : 'Multiplayer';
  // web-coop-cs phase 4 (loading) + web-coop-lobby. Every page keeps its OWN state (ownState) and tells the room; the
  // host keeps the room's list, decides what the match waits for (waitMask -> the engine's KB_CoopWait: the level's own
  // start barrier holds while a bit is set) and sends the list to every friend. A friend is "ready" on the host's list
  // when the host ENGINE says it is in its game (KISAK_COOP hold in=) AND the friend pressed Ready in its lobby.
  // Bit 0 of the mask is the host's own Start button: the match never begins before that click.
  const friends = new Map(); // host: peer -> { link, state, percent, message, skipped, late }
  const own = { name: '', percent: null, downloaded: false, started: false, loaded: false, prompt: false, clicked: false, failed: null };
  const nameInput = $('coop-name'), nameKey = 'bo1zm-player-name';
  try { own.name = playerName(localStorage.getItem(nameKey)); } catch { /* storage disabled */ }
  nameInput.value = own.name; nameInput.placeholder = code ? 'Friend' : 'Host'; $('coop-name-field').hidden = false;
  nameInput.focus();
  let hold = null, setWait = null, room = null, sent = null; // host engine's barrier; its KB_CoopWait; friend: the host's last list
  let setName = null;
  let hostStarted = false, enterGame = null, createLobby = null, live = false, watching = false;
  const defaultName = peer => peer === 1 ? 'Host' : `Friend ${peer - 1}`;
  const nameOf = peer => (peer === selfPeer() ? own.name : lobby.role === 'host' ? friends.get(peer)?.name
    : room?.players.find(p => p.peer === peer)?.name) || defaultName(peer);
  nameInput.oninput = () => {
    if (nameInput.disabled) return;
    own.name = playerName(nameInput.value);
    $('coop-name-help').textContent = nameInput.value.trim() && !own.name ? 'Use letters, numbers, spaces or . _ \' ! -'
      : 'Up to 16 letters, numbers, spaces or . _ \' ! -';
    try { localStorage.setItem(nameKey, own.name); } catch { /* not kept */ }
    setName?.(nameOf(selfPeer()));
    update();
  };
  nameInput.onblur = () => { nameInput.value = own.name; };
  const stateText = (p, details = true) => ({ lobby: 'In the lobby', connecting: 'Connecting', downloading: p.file
    ? `Downloading ${p.percent}%${details ? ' · ' + assetDescription(p.file, build.maps.find(m => m.zone === document.documentElement.dataset.map)) : ''}` : 'Loading',
    downloaded: 'Downloaded, waiting for the host', loading: 'Loading the map',
    loaded: 'Loaded, not ready yet', ready: 'Ready',
    failed: 'Could not load', late: 'Joins when the round ends' })[p.state];
  const lower = text => text.charAt(0).toLowerCase() + text.slice(1);
  function ownState() {
    if (own.failed) return 'failed';
    // Loaded = in the game (map-loaded) and the page's start prompt exists (graphics prepared, play.js ready()).
    if (own.downloaded && own.loaded && own.prompt) return lobby.role === 'host' || own.clicked ? 'ready' : 'loaded';
    if (own.percent === null) return 'lobby';
    if (own.percent < 100) return 'downloading';
    return lobby.role === 'host' || own.started ? 'loading' : 'downloaded';
  }
  const selfPeer = () => lobby.role === 'host' ? 1 : room?.you;
  const begun = () => lobby.role === 'host' ? hold?.begun === true : room?.begun === true;
  const inGame = peer => Boolean(hold && hold.in >> peer & 1);
  const clicked = f => f.state === 'ready'; // the friend's page: its player pressed Ready (after loading)
  function players() {
    const mine = { peer: selfPeer(), state: ownState(), percent: own.percent ?? 0, file: own.file ?? null, name: own.name };
    if (lobby.role !== 'host') return room ? room.players.map(p => p.peer === mine.peer && p.state !== 'late' ? mine : p) : [];
    return [mine, ...[...friends].sort(([a], [b]) => a - b).map(([peer, f]) => ({ peer, percent: f.percent, file: f.file ?? null, name: f.name ?? '',
      state: f.link !== 'connected' ? 'connecting' : f.state === 'failed' ? 'failed' : f.late || f.skipped && !inGame(peer) ? 'late'
        : ['ready', 'loaded'].includes(f.state) ? inGame(peer) ? clicked(f) ? 'ready' : 'loaded' : 'loading' : f.state }))];
  }
  // The friends the host's Start waits for: in the room, not failed, not started without, and not yet both in the
  // host's game (the engine's word) and past their Ready click. Nobody once the host has pressed Start.
  const waited = () => hostStarted || begun() ? [] : [...friends].filter(([peer, f]) => !f.skipped && !f.late && f.state !== 'failed'
    && !(inGame(peer) && clicked(f))).map(([peer]) => peer);
  const waitMask = () => waited().reduce((mask, peer) => mask | 1 << peer, hostStarted || begun() ? 0 : 1);
  const hostLoaded = () => own.downloaded && own.loaded && own.prompt && inGame(1);
  const canStart = () => lobby.role === 'host' && !hostStarted && !begun() && hostLoaded() && !waited().length;
  // The host's Start click: the engine's barrier opens (mask 0) and, in the same click (the browser gives the mouse
  // and sound only on a click), the host's page enters the game.
  function start() {
    if (!canStart()) return;
    hostStarted = true; lobby.startClick = { at: Date.now() };
    update(); enterGame?.();
  }
  // No black screen: the lobby stays over the canvas until the page has presented a real frame of the running match.
  // "Real" is decided from the canvas' own pixels (the engine draws on its own thread; the page's canvas shows the
  // last presented frame): at least a tenth of the central scene is not near black, with visible variation.
  // Excluding the edges avoids treating a HUD or loading label as the world. No timer can reveal a black canvas.
  function watchFrames() {
    if (watching || live) return;
    watching = true;
    const since = performance.now(), probe = document.createElement('canvas');
    let realSince = null;
    probe.width = 32; probe.height = 18;
    const context = probe.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      let lit = 0, sum = 0, square = 0;
      try {
        const game = $('game');
        context.drawImage(game, game.width * .1, game.height * .1, game.width * .8, game.height * .8, 0, 0, 32, 18);
        const data = context.getImageData(0, 0, 32, 18).data;
        for (let i = 0; i < data.length; i += 4) {
          const y = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
          if (y > 28) ++lit;
          sum += y; square += y * y;
        }
      } catch { lit = -1; }
      const waitedMs = Math.round(performance.now() - since);
      const deviation = Math.sqrt(Math.max(0, square / 576 - (sum / 576) ** 2));
      lobby.frame = { lit, of: 576, deviation, waitedMs };
      if (lit >= 58 && deviation >= 8) {
        realSince ??= performance.now();
      } else realSince = null;
      // A transient frame before the intro fade is not the running view. Require a continuous real scene.
      if (realSince !== null && performance.now() - realSince >= 500) {
        live = true; lobby.live = { reason: 'frame', lit, deviation, waitedMs, at: Date.now() };
        document.body.classList.add('coop-live'); update(); return;
      }
      setTimeout(tick, 100);
    };
    tick();
  }
  // play.js's own prompt (#play, under the lobby): closed while the lobby is up (a key press must not enter the
  // game), "Click to play" over the running game once this page shows it and does not hold the mouse.
  function prompt() {
    const play = $('play');
    if (window.five?.screen !== 'ready') return;
    play.textContent = 'Click to play'; play.hidden = false; play.disabled = !live;
  }
  const rowOf = new Map(); // peer -> its row (rows are kept, so a click on a row's button is never lost to a redraw)
  function drawRows(list, waiting) {
    const rows = $('coop-friends');
    rows.hidden = !list.length;
    for (const [peer, row] of rowOf) if (!list.some(p => p.peer === peer)) { row.remove(); rowOf.delete(peer); }
    for (const p of list) {
      let row = rowOf.get(p.peer);
      if (!row) {
        row = document.createElement('li');
        row.innerHTML = '<span class="name"></span><span class="state"></span><progress max="100" hidden></progress><button type="button" class="option skip" hidden></button>';
        row.dataset.peer = p.peer; rowOf.set(p.peer, row);
        row.querySelector('button').onclick = () => {
          const f = friends.get(p.peer);
          if (!f || lobby.role !== 'host') return;
          f.skipped = true; update(); start(); // starts at once when nobody else is waited for
        };
      }
      row.dataset.state = p.state;
      if (p.peer === selfPeer()) row.dataset.self = '1'; else delete row.dataset.self;
      row.querySelector('.name').textContent = nameOf(p.peer) + (p.peer === 1 && p.name ? ' (host)' : '') + (p.peer === selfPeer() ? ' (you)' : '');
      row.querySelector('.name').title = row.querySelector('.name').textContent;
      row.querySelector('.state').textContent = stateText(p);
      row.querySelector('.state').title = stateText(p);
      const bar = row.querySelector('progress');
      bar.hidden = !['downloading', 'loading'].includes(p.state);
      if (p.state === 'downloading') bar.value = p.percent; else bar.removeAttribute('value');
      const skip = row.querySelector('button');
      skip.hidden = !(lobby.role === 'host' && waiting.some(w => w.peer === p.peer));
      skip.textContent = 'Start without ' + nameOf(p.peer);
      if (rows.children[list.indexOf(p)] !== row) rows.insertBefore(row, rows.children[list.indexOf(p)] ?? null);
    }
  }
  function update() {
    if (lobby.role === 'host') {
      if (hold?.begun) for (const [peer, f] of friends) if (!inGame(peer)) f.late = true;
      setWait?.(waitMask());
    }
    const list = players();
    // Sent only when it changed (an answer to every message would bounce between the pages for ever).
    const news = JSON.stringify(lobby.role === 'host' ? [list, begun()] : [ownState(), own.percent ?? 0, own.failed, own.file, own.name]);
    if (news !== sent && lobby.transport) {
      sent = news;
      if (lobby.role === 'host') lobby.transport.roster(list, begun());
      else lobby.transport.loadState(ownState(), own.percent ?? 0, own.failed, own.file, own.name);
    }
    const me = list.find(p => p.peer === selfPeer()) ?? { peer: selfPeer(), state: ownState(), percent: own.percent ?? 0 };
    const late = lobby.role === 'join' && me.state === 'late';
    // Whom the Start button waits for (host), or whom the host still waits for as this friend sees it.
    const waiting = begun() ? [] : lobby.role === 'host' ? list.filter(p => waited().includes(p.peer))
      : list.filter(p => p.peer !== selfPeer() && p.peer !== 1 && !['ready', 'failed', 'late'].includes(p.state));
    drawRows(list, lobby.role === 'host' ? waiting : []);
    nameInput.disabled = lobby.role === 'host' ? hostStarted || begun() : own.clicked;
    if (selfPeer()) nameInput.placeholder = defaultName(selfPeer());
    const go = $('coop-go'), reason = $('coop-reason'), reasons = waiting.map(p => `${nameOf(p.peer)}: ${lower(stateText(p))}`).join(', ');
    reason.textContent = '';
    if (!lobby.transport) {
      stage('connecting'); go.hidden = !lobby.createError; go.textContent = 'Try again'; go.disabled = !createLobby || lobby.creating;
      show(lobby.createError || 'Creating lobby');
    } else if (begun() || late) {
      stage(late ? 'running' : 'starting'); go.hidden = true;
      $('coop-title').textContent = late ? 'Match in progress' : 'Starting';
      show(late ? `The match is running. You join when the round ends. ${own.loaded && own.prompt ? '' : stateText({ ...own, state: ownState(), percent: own.percent ?? 0 }, false)}` : 'The match begins');
      // The game shows once this page is in it (a late joiner: as a spectator) and has presented a real frame.
      if (own.loaded && own.prompt) watchFrames();
    } else if (lobby.role === 'host') {
      stage('lobby'); go.hidden = false; go.textContent = 'Start'; go.disabled = !canStart();
      $('coop-title').textContent = 'Multiplayer lobby';
      if (hostStarted) reason.textContent = 'Starting';
      else if (!hostLoaded()) reason.textContent = `Waiting for you: ${lower(stateText(me))}` + (reasons ? `, ${reasons}` : '');
      else if (reasons) reason.textContent = 'Waiting for ' + reasons;
      else reason.textContent = list.length > 1 ? 'Everyone is ready.' : 'Nobody has joined yet. You can start alone; friends join when a round ends.';
    } else {
      stage('lobby'); go.hidden = false;
      $('coop-title').textContent = 'Multiplayer lobby';
      const loaded = ['loaded', 'ready'].includes(ownState());
      go.disabled = !loaded || own.clicked;
      go.textContent = own.failed ? 'Could not load' : !loaded ? stateText({ ...own, state: ownState(), percent: own.percent ?? 0 }, false)
        : own.clicked ? `Waiting for ${nameOf(1) === 'Host' ? 'the host' : nameOf(1)} to start` : 'Ready';
      if (loaded && !own.clicked) reason.textContent = 'Press Ready when you are here.';
      else if (own.clicked && reasons) reason.textContent = 'Waiting for ' + reasons;
    }
    prompt();
    lobby.loading = { self: selfPeer(), clicked: own.clicked, begun: begun(), players: list, waiting: waiting.map(p => p.peer),
      mask: lobby.role === 'host' ? waitMask() : null, stage: panel.dataset.stage, canStart: canStart(), hostStarted, live };
  }
  $('coop-go').onclick = () => {
    if (!lobby.transport) { if (createLobby && !lobby.creating) { lobby.creating = true; update(); createLobby(); } return; }
    if (lobby.role === 'host') { start(); return; }
    if (['loaded', 'ready'].includes(ownState()) && !own.clicked) { own.clicked = true; lobby.readyClick = { at: Date.now() }; update(); }
  };
  // web-coop-cs: the guns of a room, from its metadata (never from this page's URL or saved settings).
  function roomGuns(metadata) {
    const cs = metadata.mods.includes(CS_MOD);
    lobby.guns = cs ? 'cs' : 'normal';
    $('coop-guns-room').textContent = 'Guns: ' + (cs ? gunsLabel(metadata.map) : 'Classic'); $('coop-guns-room').hidden = false;
  }
  let resolveHostReady;
  lobby = globalThis.__kisakCoopLobby = {
    role: code ? 'join' : 'host', settings: null, transport: null, error: null, hostLoaded: false, guns,
    hostReady: new Promise(resolve => { resolveHostReady = resolve; }),
    // play.js begin(). Host: the map pick makes the room, then the host's own game loads behind the lobby at once
    // (friends are waited for by the engine's barrier, whenever they arrive before the host's Start).
    async beforeBegin(settings, map, horde) {
      if (lobby.error) throw new Error(lobby.error);
      // web-coop-keys: in a lobby (also a retry after the page's error screen): closing the tab asks first.
      if (lobby.transport) { leaveGuard.arm('lobby'); return true; }
      lobby.createError = null;
      try {
        // web-coop-cs: the earlier choice determines the guns here (a saved Options tick does not count).
        const metadata = hostMetadata(build, map.zone, { ...settings, guns: lobby.guns }, horde);
        const room = await json(roomsURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
        lobby.settings = roomSelection(metadata, build).settings;
        roomGuns(metadata);
        lobby.startPlayers = 1; // the engine's fallback count; the wait mask decides (coop_state.cpp BrowserCoopExpected)
        connect(room.code, metadata, room.hostToken, await roomServers(room.code));
        leaveGuard.arm('lobby'); // web-coop-keys: the room exists: a closed tab would lose it (leave-guard.js)
        const invite = new URL(roomSelection(metadata, build).map.slug, base);
        invite.searchParams.set('room', room.code);
        $('coop-link').value = invite.href; $('coop-invite').hidden = false;
        update();
        return true;
      } catch (error) {
        if (lobby.transport) throw error;
        lobby.createError = error.message || 'Could not create the lobby.';
        return false;
      } finally { lobby.creating = false; update(); }
    },
    // play.js: the page is ready to begin (cache inspected). Multiplayer never starts without a room: the only
    // initial caller of begin() on a host page is the completed choice/map flow.
    landing(begin) { createLobby = begin; if (lobby.role === 'host' && !lobby.transport && !lobby.creating) { lobby.creating = true; begin(); } update(); },
    progress(percent, downloaded = false, file = null) {
      percent = Math.floor(percent);
      if (percent === lobby.percent && downloaded === own.downloaded && file === own.file) return;
      own.downloaded = downloaded; own.file = file;
      lobby.percent = own.percent = percent; own.failed = null; update();
    },
    // web-coop-cs phase 4: play.js / engine.js hooks. failed: this page showed an error screen (not the storage
    // question, which the player can still answer); gate: the start prompt appeared; engineWait: the host engine's
    // KB_CoopWait; onHold: the host engine's "KISAK_COOP hold" line (begun = the script's all_players_connected flag).
    failed(kind, message) { if (kind === 'persistence' || own.failed) return; own.failed = String(message).split('\n')[0]; update(); },
    // play.js ready(): the game is loaded and its start prompt exists; enter = the prompt's click handler (mouse,
    // sound). The lobby calls it from the host's Start click; a friend clicks "Click to play" over the running game.
    gate(enter) { if (enter) enterGame = enter; own.prompt = true; update(); },
    engineWait(set) { setWait = set; set(waitMask()); },
    get playerName() { return nameOf(selfPeer()); },
    engineName(set) { setName = set; set(lobby.playerName); },
    onHold(line) {
      const match = /begun=(-?\d+) wait=(-?\d+) in=(\d+)/.exec(line);
      if (match) { hold = { begun: match[1] === '1', in: Number(match[3]) }; update(); }
    },
  };
  function failedLine(peer) {
    $('coop-failure').textContent = `${nameOf(peer)} could not load.`; $('coop-failure').hidden = false;
  }
  // web-coop-relay: the room's ICE servers, asked before the first RTCPeerConnection: the STUN list and, when the
  // site's relay budget allows it, a relay (TURN) entry for this player. The relay is the fallback: a direct route
  // stays the first choice. No answer (an older room service, a failure): the page connects as it always did.
  // ?relay=1 (a debug option): this page uses nothing but the relay.
  const relayOnly = query.get('relay') === '1';
  async function roomServers(roomCode) {
    try { return roomIce(await json(roomsURL + '/' + roomCode + '/ice', { signal: AbortSignal.timeout(6000) })); } catch { return null; }
  }
  // The small note: which links of this page go through the relay (net.js path(), from getStats()).
  function relayNote() {
    const relayed = Object.entries(lobby.transport?.stats.peers ?? {}).filter(([, p]) => p.path?.relayed).map(([peer]) => Number(peer));
    $('coop-relay').textContent = !relayed.length ? '' : lobby.role === 'host' ? 'Relayed connection: ' + relayed.map(nameOf).join(', ') : 'Relayed connection';
    $('coop-relay').hidden = !relayed.length;
  }
  function connect(roomCode, metadata, hostToken, servers) {
    lobby.transport = rtcTransport({ roomURL: roomsURL + '/' + roomCode, role: lobby.role, metadata, hostToken,
      peerName: peer => nameOf(peer) === defaultName(peer) ? null : nameOf(peer),
      ...(config.iceServers ? { iceServers: config.iceServers } : servers ? { iceServers: servers.iceServers } : {}),
      relayServers: servers?.relayServers ?? [], relayOnly,
      onState(message, peer) {
        relayNote();
        if (lobby.role === 'host' && peer) {
          // A friend who arrives after the host pressed Start is a late joiner (spectates until the round ends).
          if (message === 'connecting' || message === 'connected')
            friends.set(peer, { state: 'downloading', percent: 0, late: hostStarted || begun(), ...friends.get(peer), link: message });
          else {
            if (friends.get(peer)?.state === 'failed') failedLine(peer);
            friends.delete(peer); // gone: the match no longer waits for this friend
          }
          update();
        }
        if (window.five) window.five.coopStatus = message;
        if (message === 'connected') {
          show(lobby.role === 'host' ? '' : 'Connected to ' + nameOf(1));
          if (lobby.hostLoaded) lobby.transport?.start();
          sent = null; update(); // a new link: it gets the current list / state
        } else if (message === 'connecting') show(lobby.role === 'host' ? 'A friend is connecting' : 'Connecting to the host');
        else if (lobby.role === 'host' && peer && message !== 'closed') show(message);
        else if (lobby.role === 'host' && lobby.startPlayers && message !== 'closed') {
          // coop-web: a host whose game is loading or running keeps it when the room service goes away.
          show('The invite link stopped working. Reload to invite again.');
        }
        else if (message !== 'closed') {
          lobby.error = message;
          resolveHostReady();
          failure(new Error(message));
        }
      },
    });
    lobby.transport.onPeerState = (state, peer) => {
      const friend = friends.get(peer);
      if (lobby.role !== 'host' || !friend) return;
      Object.assign(friend, state);
      if (state.state === 'failed') failedLine(peer);
      update();
    };
    lobby.transport.onRoster = message => { room = message; if (!begun()) show('Connected to ' + nameOf(1)); relayNote(); update(); };
    lobby.transport.onPath = relayNote;
    lobby.transport.onStart = () => { own.started = true; resolveHostReady(); update(); };
    // If the host disappears before loading, release the pending engine through its normal error path.
    lobby.transport.ready.catch(error => { lobby.error = error.message; resolveHostReady(); });
    show(lobby.role === 'host' ? 'Share the invite link.' : 'Connecting to the host');
    if (window.five) window.five.transport = lobby.transport.stats;
  }
  if (code) {
    if (!/^[A-Z2-9]{8}$/.test(code)) throw new Error('Invalid invite link.');
    const { createdAt, ...metadata } = await json(roomsURL + '/' + code);
    const selection = roomSelection(metadata, build);
    lobby.settings = selection.settings;
    roomGuns(metadata);
    document.documentElement.dataset.map = metadata.map;
    document.documentElement.dataset.mode = metadata.horde ? 'horde' : 'normal';
    document.title = selection.map.name + ' · Multiplayer';
    document.documentElement.style.setProperty('--art', `url(${new URL('art/loadscreen_' + metadata.map + '.webp', base)})`);
    $('game').setAttribute('aria-label', selection.map.name);
    $('coop-map').textContent = selection.map.name + (metadata.horde ? ' · Hell mode' : '');
    const invite = new URL(selection.map.slug, base);
    invite.searchParams.set('room', code);
    $('coop-link').value = invite.href; $('coop-invite').hidden = false;
    stage('lobby');
    connect(code, metadata, undefined, await roomServers(code));
    await lobby.transport.ready;
    leaveGuard.arm('lobby'); // web-coop-keys: joined: from here the browser asks before this tab closes
  }
  $('coop-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('coop-link').value); $('coop-copy').textContent = 'Copied'; }
    catch { $('coop-link').focus(); $('coop-link').select(); show('Copy the selected link to invite your friend.'); }
  };
  addEventListener('kisak-map-loaded', () => {
    if (lobby.role === 'host') { lobby.hostLoaded = true; lobby.transport?.start(); }
    own.loaded = true; update(); // in the game (a friend: active on the host's server), able to play the next frame
  });
  addEventListener('pagehide', () => lobby.transport?.close());
  update();
  await import('./play.js');
  // web-coop-keys: the lobby's Fullscreen box is the page's own option (play.js has read the saved one and reads it
  // again at the start click); hidden where the browser has no fullscreen.
  const pageFullscreen = $('fullscreen'), lobbyFullscreen = $('coop-fullscreen-box');
  if (pageFullscreen && !pageFullscreen.disabled) {
    lobbyFullscreen.checked = pageFullscreen.checked; $('coop-fullscreen').hidden = false;
    lobbyFullscreen.oninput = () => { pageFullscreen.checked = lobbyFullscreen.checked; pageFullscreen.dispatchEvent(new Event('input', { bubbles: true })); };
  }
  if (lobby.error) failure(new Error(lobby.error));
  }
} catch (error) { failure(error); }
