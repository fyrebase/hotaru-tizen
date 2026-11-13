// Hotaru for Samsung TVs: a TizenBrew app module that browses and plays a Plex server.
// No build step, so the syntax has to run on Tizen 4's Chromium 56: no `?.`, `??`, object
// spread, `.at()`, or trailing commas in calls.

const cfg = { server: '', name: '', token: '' };
// boot() gives each install its own identifier, which plex.tv lists as a device of the account.
const CLIENT = { 'X-Plex-Client-Identifier': 'hotaru-tv', 'X-Plex-Product': 'Hotaru' };
const PLEX_TV = 'https://plex.tv/api/v2';

// Everything rides in the query, not headers: a custom header makes every request a CORS preflight.
function withParams(base, params) {
  const u = new URL(base);
  Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  return u.href;
}

const url = (path, params) => withParams(cfg.server + path, Object.assign({}, params, { 'X-Plex-Token': cfg.token }, CLIENT));

async function getJson(href, method) {
  const r = await fetch(href, { method: method || 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Plex answered ' + r.status);
  return r.json();
}

const plexTv = (path, params, method) => getJson(withParams(PLEX_TV + path, Object.assign({}, params, CLIENT)), method);

async function list(path) {
  const mc = (await getJson(url(path))).MediaContainer;
  const items = (mc.Directory || []).concat(mc.Metadata || []);
  const recent = recentFolder(path, mc.viewGroup);
  if (recent) items.unshift(recent);
  return path.endsWith(RECENT) ? Promise.all(oneEachShow(items).map(upNext)) : items;
}

// A finished episode's card moves on to the episode after it, so OK plays what's next rather than
// the end credits again. An episode part way through, even a rewatch, stays put and resumes.
// One lookup per finished show, all at once; a failed one, or the show's last episode, leaves
// the card as it was.
async function upNext(ep) {
  if (!ep.grandparentRatingKey || !ep.viewCount || ep.viewOffset) return ep;
  const eps = await list(`/library/metadata/${ep.grandparentRatingKey}/allLeaves`).catch(() => []);
  const next = nextAfter(eps, ep);
  if (!next) return ep;
  return Object.assign(next, { thumb: ep.thumb, label: ep.label, sub: 'Next: ' + heading(next)[1] });
}

function nextAfter(eps, ep) {
  const at = eps.findIndex((e) => e.ratingKey === ep.ratingKey);
  return at < 0 ? null : eps[at + 1] || null;
}

// Most recently watched first; the filter drops never-watched items.
const RECENT = 'sort=lastViewedAt:desc&lastViewedAt%3E%3E=0&X-Plex-Container-Start=0&X-Plex-Container-Size=100';

// A movie or TV library's "all" listing opens with a Recently Played folder. Shows are listed
// by episode, so each entry says where you are in the show.
function recentFolder(path, viewGroup) {
  const id = /^\/library\/sections\/(\w+)\/all$/.exec(path);
  const type = { movie: 1, show: 4 }[viewGroup];
  if (!id || !type) return null;
  return { title: 'Recently Played', icon: 'history', key: `/library/sections/${id[1]}/all?type=${type}&${RECENT}` };
}

// One card per show, its latest episode, under the show's name and poster: episode stills are 16:9.
function oneEachShow(items) {
  const seen = {};
  return items.filter((i) => {
    const show = i.grandparentRatingKey;
    if (!show) return true;
    if (seen[show]) return false;
    seen[show] = true;
    i.thumb = i.grandparentThumb || i.thumb;
    i.label = i.grandparentTitle;
    return true;
  });
}

// Lucide icons, for cards with no artwork.
const ICONS = {
  history:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>'
};

// A server's addresses, best first: on the network before remote, relayed last. A local HTTPS
// address is a plex.direct name, which some routers' DNS refuses to resolve to a private
// address, so its plain IP over HTTP follows it.
function candidates(connections) {
  const rank = (c) => (c.relay ? 2 : 0) + (c.local ? 0 : 1);
  return connections
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .reduce((out, c) => out.concat(c.uri, c.local && c.protocol === 'https' ? ['http://' + c.address + ':' + c.port] : []), []);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// No AbortController before Chromium 66, so a slow address is outwaited rather than cancelled.
const answers = (base) =>
  Promise.race([fetch(base + '/identity').then((r) => r.ok, () => false), sleep(4000).then(() => false)]);

// The account's servers, each at its best address that answered. Every address is tried at
// once, so this takes as long as the slowest, at most 4 s.
async function servers(accountToken) {
  const resources = await plexTv('/resources', { includeHttps: 1, includeRelay: 1, 'X-Plex-Token': accountToken });
  const found = await Promise.all(
    resources
      .filter((r) => r.provides.split(',').includes('server'))
      .map(async (r) => {
        const tries = candidates(r.connections);
        const ok = await Promise.all(tries.map(answers));
        const at = tries[ok.indexOf(true)];
        // The server's own token: for a server shared with the account, the account's isn't accepted.
        return at && { name: r.name, url: at, token: r.accessToken || accountToken };
      })
  );
  return found.filter(Boolean);
}

// Libraries, keyed straight to their "all" listing, under Plex's collage of their latest additions.
// updatedAt in the path changes with the library, so a cached collage never goes stale.
async function sections() {
  return (await list('/library/sections')).map((d) =>
    Object.assign(d, {
      thumb: `/library/sections/${d.key}/composite/${d.updatedAt || 0}?width=480&height=720`,
      key: `/library/sections/${d.key}/all`
    })
  );
}

const poster = (thumb) => url('/photo/:/transcode', { width: 480, height: 720, minSize: 1, url: thumb });

// H.264 MP4 plays straight off the server; anything else Plex remuxes to HLS, re-encoding only what
// the profile can't take. `session` is the HLS session to stop afterwards.
// ponytail: the Safari profile, as on the Mac, re-encodes HEVC; a Tizen profile could pass HEVC and HDR through.
function stream(item) {
  const m = (item.Media || [])[0];
  const p = m && m.Part && m.Part[0];
  if (p && ['mp4', 'm4v', 'mov'].includes(p.container) && m.videoCodec === 'h264') return { src: url(p.key) };
  const session = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
  const src = url('/video/:/transcode/universal/start.m3u8', {
    path: '/library/metadata/' + item.ratingKey,
    mediaIndex: 0,
    partIndex: 0,
    protocol: 'hls',
    fastSeek: 1,
    directPlay: 0,
    directStream: 1,
    directStreamAudio: 1,
    location: 'lan',
    // Not X-Plex-Session-Identifier: equal to `session` it makes PMS answer 400.
    session,
    'X-Plex-Platform': 'Safari'
  });
  return { src, session };
}

// Show, then "S1 · E2 · Title" for an episode; title, then year for anything else.
function heading(item) {
  if (!item.grandparentTitle) return [item.title, item.year || ''];
  const ep = [item.parentIndex != null && 'S' + item.parentIndex, item.index != null && 'E' + item.index, item.title];
  return [item.grandparentTitle, ep.filter(Boolean).join(' · ')];
}

const $ = (id) => document.getElementById(id);
const stack = []; // pages browsed into: { title, key, at }, the libraries first
let playing = null; // { item, session, hls }
let osdTimer;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const status = (text) => {
  $('status').textContent = text;
};

async function show(page) {
  const grid = $('grid');
  $('title').textContent = page.title;
  status('');
  grid.classList.remove('in');
  let items;
  try {
    items = page.key ? await list(page.key) : await sections();
  } catch (e) {
    return status(e.message);
  }
  grid.innerHTML = '';
  grid.scrollTop = 0;
  // ponytail: every item at once; page with X-Plex-Container-Size if big libraries crawl.
  items.forEach((item) => {
    const card = el('button', 'card');
    const img = new Image();
    img.loading = 'lazy';
    img.onload = () => img.classList.add('in');
    if (item.thumb) img.src = poster(item.thumb);
    const art = el('div', 'art');
    if (item.icon) art.innerHTML = ICONS[item.icon];
    else art.append(img);
    const sub = item.sub || (item.type === 'episode' ? heading(item)[1] : item.year);
    card.append(art, el('span', '', item.label || item.title), el('span', 'dim', sub ? String(sub) : ' '));
    card.onclick = () => open(item);
    grid.append(card);
  });
  if (!items.length) status('Nothing here');
  focusCard(grid.children[page.at || 0]);
  requestAnimationFrame(() => grid.classList.add('in'));
}

function focusCard(card) {
  if (!card) return;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function open(item) {
  if (item.Media) return play(item);
  stack[stack.length - 1].at = Array.from($('grid').children).indexOf(document.activeElement);
  stack.push({ title: item.title, key: item.key });
  show(stack[stack.length - 1]);
}

function back() {
  if (stack.length > 1) {
    stack.pop();
    show(stack[stack.length - 1]);
  } else signIn(); // the libraries' Back: sign in again, or Back once more to stay
}

// D-pad: the focused card moves by one, or a row's worth of cards up and down.
function move(dx, dy) {
  const cards = Array.from($('grid').children);
  if (!cards.length) return;
  const i = cards.indexOf(document.activeElement);
  if (i < 0) return focusCard(cards[0]);
  const cols = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length;
  let j = i + dx + dy * cols;
  // Down from above a short last row lands on its last card.
  if (dy > 0 && j >= cards.length && Math.floor(i / cols) < Math.floor((cards.length - 1) / cols)) j = cards.length - 1;
  focusCard(cards[j]);
}

function play(item) {
  const s = stream(item);
  const v = $('video');
  playing = { item, session: s.session };
  $('player').hidden = false;
  // Tizen plays HLS itself; desktop browsers without it get hls.js.
  if (s.session && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls) {
    playing.hls = new Hls();
    playing.hls.loadSource(s.src);
    playing.hls.attachMedia(v);
  } else v.src = s.src;
  if (item.viewOffset) {
    v.addEventListener('loadedmetadata', () => (v.currentTime = item.viewOffset / 1000), { once: true });
  }
  v.play().catch(() => {});
  const h = heading(item);
  $('osd-title').textContent = h[0];
  $('osd-sub').textContent = h[1];
  osd();
}

// ponytail: no /:/timeline reports, so Plex sees no progress or watched state; add them with
// the same care as the Mac app, since the library is shared.
function stop() {
  if (!playing) return;
  const v = $('video');
  if (playing.hls) playing.hls.destroy();
  v.removeAttribute('src');
  v.load();
  // Plex refuses new streams of an item while a stale session for it lingers.
  if (playing.session) {
    fetch(url('/video/:/transcode/universal/stop', { session: playing.session }), { keepalive: true }).catch(() => {});
  }
  playing = null;
  $('player').hidden = true;
}

const pad = (n) => (n < 10 ? '0' : '') + n;
function clock(s) {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
}

function time() {
  const v = $('video');
  $('osd-time').textContent = clock(v.currentTime) + ' / ' + clock(v.duration);
}

function osd() {
  time();
  $('osd').classList.add('in');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => $('osd').classList.remove('in'), 3000);
}

function playerKey(k) {
  const v = $('video');
  if (k === 'back' || k === 'stop') return stop();
  if (k === 'enter' || k === 'playpause') v.paused ? v.play() : v.pause();
  if (k === 'play') v.play();
  if (k === 'pause') v.pause();
  const jump = { left: -10, right: 10, rew: -30, ff: 30 }[k];
  if (jump) v.currentTime = Math.max(0, v.currentTime + jump);
  osd();
}

// The sign-in screen: a message, the code if any, and buttons to choose from, the first focused.
function signinScreen(msg, code, choices) {
  $('browse').hidden = true;
  $('signin').hidden = false;
  $('signin-msg').textContent = msg;
  $('code').textContent = code || '';
  const list = $('choices');
  list.innerHTML = '';
  (choices || []).forEach((c) => {
    const b = el('button', '', c[0]);
    b.onclick = c[1];
    list.append(b);
  });
  if (list.firstChild) list.firstChild.focus();
}

// Signing in through plex.tv/link: show a code, poll until it's entered, then pick a server.
// The saved server stays until a new one is chosen, so Back leaves sign-in unchanged.
let signins = 0;
async function signIn() {
  const run = ++signins;
  const live = () => run === signins && !$('signin').hidden;
  signinScreen('Getting a code\u2026');
  try {
    let pin = await plexTv('/pins', {}, 'POST');
    const expires = Date.now() + pin.expiresIn * 1000;
    if (!live()) return;
    signinScreen('On your phone or computer, go to plex.tv/link and enter this\u00a0code', pin.code);
    while (!pin.authToken) {
      await sleep(2000);
      if (!live()) return;
      if (Date.now() > expires) return signIn();
      pin = await plexTv('/pins/' + pin.id, { code: pin.code });
    }
    if (!live()) return;
    signinScreen('Finding your\u00a0servers\u2026');
    const found = await servers(pin.authToken);
    if (!live()) return;
    if (!found.length) throw new Error('No Plex server on this account\u00a0answered');
    if (found.length === 1) return use(found[0]);
    signinScreen('Choose a\u00a0server', '', found.map((s) => [s.name, () => use(s)]));
  } catch (e) {
    if (live()) signinScreen(e.message, '', [['Try again', signIn]]);
  }
}

function use(server) {
  Object.assign(cfg, { server: server.url, name: server.name, token: server.token });
  localStorage.setItem('plexUrl', cfg.server);
  localStorage.setItem('plexServer', cfg.name);
  localStorage.setItem('plexToken', cfg.token);
  browse();
}

function browse() {
  $('signin').hidden = true;
  $('browse').hidden = false;
  stack.length = 0;
  stack.push({ title: cfg.name || 'Libraries' });
  show(stack[0]);
}

// Tizen remote key codes, with their desktop keyboard equivalents for testing.
const KEYS = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  10009: 'back', 27: 'back', 8: 'back',
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 412: 'rew', 417: 'ff'
};

function onKey(e) {
  const k = KEYS[e.keyCode];
  if (!k) return;
  if (playing) {
    e.preventDefault();
    return playerKey(k);
  }
  if (!$('signin').hidden) {
    const buttons = Array.from($('choices').children);
    const next = { up: -1, down: 1 }[k];
    if (next) {
      e.preventDefault();
      const b = buttons[buttons.indexOf(document.activeElement) + next];
      if (b) b.focus();
    } else if (k === 'back' && cfg.server) {
      e.preventDefault();
      browse();
    }
    return;
  }
  if (k === 'enter') return; // the focused card's own click
  e.preventDefault();
  if (k === 'back') return back();
  const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[k];
  if (d) move(d[0], d[1]);
}

function boot() {
  cfg.server = localStorage.getItem('plexUrl') || '';
  cfg.name = localStorage.getItem('plexServer') || '';
  cfg.token = localStorage.getItem('plexToken') || '';
  if (!localStorage.getItem('clientId')) localStorage.setItem('clientId', 'hotaru-tv-' + Math.random().toString(16).slice(2));
  CLIENT['X-Plex-Client-Identifier'] = localStorage.getItem('clientId');
  document.addEventListener('keydown', onKey);
  const v = $('video');
  v.ontimeupdate = time;
  v.onended = stop;
  v.onerror = () => {
    stop();
    status("That didn't play");
  };
  addEventListener('pagehide', stop);
  cfg.server && cfg.token ? browse() : signIn();
}

if (typeof document !== 'undefined') boot();
if (typeof module === 'object') module.exports = { cfg, url, stream, heading, clock, candidates, recentFolder, oneEachShow, nextAfter, RECENT };
