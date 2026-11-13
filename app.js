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

// A card's title and the detail under it. In a season, an episode is "Episode 2" over its
// title, which would be cut off as the card's title. Under a show's name, as in Recently
// Played, it's "S1 · E2 · Title".
function label(item) {
  if (item.label) return [item.label, item.sub || heading(item)[1]];
  if (item.type === 'episode' && item.index != null) return ['Episode ' + item.index, item.title];
  return [item.title, item.type === 'episode' ? heading(item)[1] : item.year];
}

// Wrapped text never ends on a lone word (DESIGN.md): the last two words share a no-break space.
const noOrphan = (text) => text.replace(/ (\S+)$/, '\u00a0$1');

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

// Lucide icons: for cards with no artwork, and on action buttons.
const lucide = (paths) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  paths +
  '</svg>';
const ICONS = {
  history: lucide('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  play: lucide('<polygon points="6 3 20 12 6 21 6 3"/>'),
  rotateCcw: lucide('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>')
};

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const tags = (list, n) => (list || []).slice(0, n).map((t) => t.tag).join(', ');

// Shows and seasons: "12 episodes", or "5 of 12 watched" part way through.
function episodes(a) {
  const n = a.leafCount;
  if (n == null) return '';
  const w = a.viewedLeafCount || 0;
  return w === 0 || w >= n ? plural(n, 'episode') : w + ' of ' + n + ' watched';
}

// The facts line on a page: "2021 · TV-14 · 2 seasons · ★ 8.1 · Animation, Action".
function facts(a) {
  const m = Math.floor((a.duration || 0) / 60000);
  const runtime = a.type === 'movie' && m && (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
  return [
    a.year,
    a.contentRating,
    runtime,
    a.type === 'show' && a.childCount && plural(a.childCount, 'season'),
    a.type === 'season' && episodes(a),
    a.audienceRating && '★ ' + a.audienceRating.toFixed(1),
    tags(a.Genre, 3)
  ]
    .filter(Boolean)
    .join(' · ');
}

function credits(a) {
  const by = (word, names) => names && word + ' ' + names;
  return [a.studio, by('Directed by', tags(a.Director, 2)), by('Written by', tags(a.Writer, 2)), by('Starring', tags(a.Role, 4))]
    .filter(Boolean)
    .join('  ·  ');
}

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

// A listing, and for a movie, show or season the item itself, which carries its details and
// backdrop. A movie's page lists nothing else.
async function load(path) {
  const id = /^\/library\/metadata\/(\d+)(\/.*)?$/.exec(path);
  if (!id) return { items: await list(path) };
  if (!id[2]) return { items: [], about: (await list(path))[0] };
  // A show's seasons, a season's episodes, or all a show's episodes: the listing has a line of
  // summary at most, so fetch the item it lists too.
  const both = await Promise.all([list(path), list('/library/metadata/' + id[1])]);
  return { items: both[0], about: both[1][0] };
}

async function show(page) {
  $('title').textContent = page.title;
  status('');
  $('grid').classList.remove('in');
  backdrop(null);
  try {
    page.data = page.key ? await load(page.key) : { items: await sections() };
  } catch (e) {
    return status(e.message);
  }
  render(page);
}

// The show's or movie's art, faint behind its page, fading in once it has loaded.
function backdrop(art) {
  const img = $('backdrop');
  const src = art ? url('/photo/:/transcode', { width: 1920, height: 1080, minSize: 1, url: art }) : '';
  if (img.getAttribute('src') === src || (!src && !img.hasAttribute('src'))) return;
  img.classList.remove('in');
  if (src) img.src = src;
  else img.removeAttribute('src');
}

function render(page) {
  const grid = $('grid');
  const d = page.data;
  grid.innerHTML = '';
  grid.scrollTop = 0;
  backdrop(d.about && d.about.art);
  if (d.about) grid.append(aboutBlock(d.about));
  // ponytail: every item at once; page with X-Plex-Container-Size if big libraries crawl.
  d.items.forEach((item) => {
    const card = el('button', 'card');
    const img = new Image();
    img.loading = 'lazy';
    img.onload = () => img.classList.add('in');
    if (item.thumb) img.src = poster(item.thumb);
    const art = el('div', 'art');
    if (item.icon) art.innerHTML = ICONS[item.icon];
    else art.append(img);
    const text = label(item);
    card.append(art, el('span', '', text[0]), el('span', 'dim', text[1] ? noOrphan(String(text[1])) : ' '));
    card.onclick = () => open(item);
    grid.append(card);
  });
  if (!d.items.length && !d.about) status('Nothing here');
  focusCard(focusables()[page.at || 0]);
  requestAnimationFrame(() => grid.classList.add('in'));
}

// A movie's, show's or season's details, heading its page. A movie's page has nothing else on
// it, so it gets the poster and Play, and room for the whole summary.
function aboutBlock(a) {
  const movie = a.type === 'movie';
  const box = el('div', 'about');
  if (movie && a.thumb) {
    const img = new Image();
    img.className = 'about-poster';
    img.onload = () => img.classList.add('in');
    img.src = poster(a.thumb);
    box.append(img);
  }
  const text = el('div', 'about-text');
  const lines = [
    ['dim', facts(a)],
    ['tagline', a.tagline],
    [movie ? 'summary long' : 'summary', a.summary],
    ['dim credits', credits(a)]
  ];
  lines.forEach((l) => l[1] && text.append(el('div', l[0], noOrphan(l[1]))));
  if (movie && a.Media) {
    const actions = el('div', 'actions');
    if (a.viewOffset > 0) {
      actions.append(key('Resume', 'play', () => play(a)), key('Play from Start', 'rotateCcw', () => play(a, true)));
    } else actions.append(key('Play', 'play', () => play(a)));
    text.append(actions);
  }
  box.append(text);
  return box;
}

// An action button, raised in its own inset track (DESIGN.md).
function key(text, icon, onclick) {
  const track = el('span', 'track');
  const b = el('button', 'key');
  b.innerHTML = icon ? ICONS[icon] : '';
  b.append(text);
  b.onclick = onclick;
  track.append(b);
  return track;
}

// Everything the D-pad can land on in the page: the details' buttons, then the cards.
const focusables = () => Array.from($('grid').querySelectorAll('button'));

function focusCard(card) {
  if (!card) return;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function open(item) {
  // A movie gets its page; an episode plays straight from its card.
  if (item.Media && item.type !== 'movie') return play(item);
  const top = stack[stack.length - 1];
  top.at = focusables().indexOf(document.activeElement);
  // A season's page leads with its show. "All episodes" doesn't name the show, but it's opened
  // from the show's own page, whose title is the show.
  const parent = item.parentTitle || (/\/allLeaves$/.test(item.key) && top.title);
  stack.push({ title: parent ? parent + ' / ' + item.title : item.title, key: item.key });
  show(stack[stack.length - 1]);
}

function back() {
  if (stack.length > 1) {
    stack.pop();
    show(stack[stack.length - 1]);
  } else signIn(); // the libraries' Back: sign in again, or Back once more to stay
}

// D-pad: focus moves to the nearest button on screen in that direction, so the details' buttons
// and a grid's short last row need no special cases. Left and right stay within the row.
function move(dir) {
  const all = focusables();
  const cur = document.activeElement;
  if (all.indexOf(cur) < 0) return focusCard(all[0]);
  focusCard(nearest(cur.getBoundingClientRect(), all.filter((b) => b !== cur).map((b) => [b, b.getBoundingClientRect()]), dir));
}

// The candidate (as [thing, rect]) nearest `from` in `dir`, weighing distance off the line of
// travel double, so the next card in a row beats a nearer one in the next row.
function nearest(from, candidates, dir) {
  const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const a = mid(from);
  let best = null;
  let bestScore = Infinity;
  candidates.forEach((c) => {
    const b = mid(c[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const across = dir === 'left' || dir === 'right';
    const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
    if (along <= 1 || (across && Math.abs(dy) > from.height / 2)) return;
    const score = along + 2 * Math.abs(across ? dy : dx);
    if (score < bestScore) [best, bestScore] = [c[0], score];
  });
  return best;
}

// `fromStart`: ignore the item's resume point.
function play(item, fromStart) {
  const s = stream(item);
  const v = $('video');
  playing = { item, session: s.session };
  playing.timer = setInterval(() => report(v.paused ? 'paused' : 'playing'), 10000);
  $('player').hidden = false;
  // Tizen plays HLS itself; desktop browsers without it get hls.js.
  if (s.session && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls) {
    playing.hls = new Hls();
    playing.hls.loadSource(s.src);
    playing.hls.attachMedia(v);
  } else v.src = s.src;
  if (item.viewOffset && !fromStart) {
    v.addEventListener('loadedmetadata', () => (v.currentTime = item.viewOffset / 1000), { once: true });
  }
  v.play().catch(() => {});
  const h = heading(item);
  $('osd-title').textContent = h[0];
  $('osd-sub').textContent = h[1];
  osd();
}

// Progress for Plex, as the Mac app sends it: every 10 s while playing or paused, and once on
// stopping. It's what resumes the item elsewhere, and Plex marks it watched past about 90%.
function timeline(item, state, ms) {
  return url('/:/timeline', {
    ratingKey: item.ratingKey,
    key: '/library/metadata/' + item.ratingKey,
    state,
    time: Math.round(ms),
    duration: item.duration || 0
  });
}

// Never at 0: that's a stream that failed to start, or one left before the resume seek, and
// reporting it would wipe the item's place. ponytail: best effort, the next tick retries.
function report(state) {
  const ms = $('video').currentTime * 1000;
  if (playing && ms > 0) fetch(timeline(playing.item, state, ms), { keepalive: true }).catch(() => {});
}

function stop() {
  if (!playing) return;
  const v = $('video');
  clearInterval(playing.timer);
  report('stopped');
  // The item's resume point as Plex now has it, so its card or page resumes from here without
  // fetching it again: cleared past about 90%, where Plex marks it watched.
  const it = playing.item;
  const ms = v.currentTime * 1000;
  if (ms > 0) it.viewOffset = it.duration && ms > 0.9 * it.duration ? 0 : ms;
  if (playing.hls) playing.hls.destroy();
  v.removeAttribute('src');
  v.load();
  // Plex refuses new streams of an item while a stale session for it lingers.
  if (playing.session) {
    fetch(url('/video/:/transcode/universal/stop', { session: playing.session }), { keepalive: true }).catch(() => {});
  }
  playing = null;
  $('player').hidden = true;
  // A movie's page offers Resume or Play by where it was left.
  const top = stack[stack.length - 1];
  if (top && top.data && top.data.about === it) {
    top.at = focusables().indexOf(document.activeElement);
    render(top);
  }
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
  (choices || []).forEach((c) => list.append(key(c[0], null, c[1])));
  const first = list.querySelector('button');
  if (first) first.focus();
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
    const buttons = Array.from($('choices').querySelectorAll('button'));
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
  if (k === 'left' || k === 'right' || k === 'up' || k === 'down') move(k);
}

function boot() {
  cfg.server = localStorage.getItem('plexUrl') || '';
  cfg.name = localStorage.getItem('plexServer') || '';
  cfg.token = localStorage.getItem('plexToken') || '';
  if (!localStorage.getItem('clientId')) localStorage.setItem('clientId', 'hotaru-tv-' + Math.random().toString(16).slice(2));
  CLIENT['X-Plex-Client-Identifier'] = localStorage.getItem('clientId');
  document.addEventListener('keydown', onKey);
  $('backdrop').onload = () => $('backdrop').classList.add('in');
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
if (typeof module === 'object') module.exports = { cfg, url, stream, heading, clock, candidates, recentFolder, oneEachShow, nextAfter, label, timeline, facts, credits, nearest, RECENT };
