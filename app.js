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
// Played, it's "S1 · E2 · Title". A card the app makes itself brings its own `sub`.
function label(item) {
  if (item.label) return [item.label, item.sub || heading(item)[1]];
  if (item.sub) return [item.title, item.sub];
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
  rotateCcw: lucide('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  check: lucide('<path d="M20 6 9 17l-5-5"/>'),
  logIn: lucide('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>')
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
const still = (thumb) => url('/photo/:/transcode', { width: 640, height: 360, minSize: 1, url: thumb });

// The codecs parameter `canPlayType` takes for Plex's codec names. HEVC is asked for at level
// 5.1, 4K's, and as Main 10 when the file is 10-bit, so a "yes" covers the file.
const CODECS = {
  h264: () => 'avc1.640028',
  hevc: (m) => (m.videoProfile === 'main 10' ? 'hvc1.2.4.L153.B0' : 'hvc1.1.6.L153.B0'),
  aac: () => 'mp4a.40.2',
  ac3: () => 'ac-3',
  eac3: () => 'ec-3',
  mp3: () => 'mp4a.69',
  flac: () => 'fLaC',
  opus: () => 'Opus',
  alac: () => 'alac'
};

// The type `canPlayType` takes for each container Plex names.
const CONTAINERS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', mkv: 'video/x-matroska' };

// Whether the player says it can play the file as it is, sound included: Chrome plays an MP4 with
// AC-3 sound in silence, where the TV plays it whole. `canPlay` is the video element's
// canPlayType, passed in so this needs no DOM. A "yes" can still be wrong, MKV above all, so
// `play` falls back to Plex when a file played this way fails to start.
function directPlay(m, canPlay) {
  const p = m && m.Part && m.Part[0];
  const type = p && CONTAINERS[p.container];
  if (!type) return false;
  const codecs = [m.videoCodec, m.audioCodec].filter(Boolean).map((c) => CODECS[c] && CODECS[c](m));
  return codecs.length > 0 && codecs.every(Boolean) && canPlay(type + '; codecs="' + codecs.join(', ') + '"') !== '';
}

// Plays straight off the server what the player can take as it is; anything else, or anything
// with `viaPlex`, Plex remuxes to HLS, re-encoding only what the profile can't take. `session` is
// the HLS session to stop afterwards.
// ponytail: the Safari profile, as on the Mac, re-encodes HEVC; a Tizen profile could pass HEVC
// through what the player can't take whole, such as DTS sound.
function stream(item, canPlay, viaPlex) {
  const m = (item.Media || [])[0];
  if (!viaPlex && directPlay(m, canPlay)) return { src: url(m.Part[0].key) };
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
let seekTo = null; // where Left, Right, Rew and FF are taking playback, until it seeks there
let seekTimer;

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
  theme(d.about && (d.about.theme || d.about.parentTheme));
  if (d.about) grid.append(aboutBlock(d.about));
  // The libraries end with a way to sign in to another account or server, as Back there leaves
  // the app. ponytail: every item at once; page with X-Plex-Container-Size if big libraries crawl.
  const items = page.key ? d.items : d.items.concat({ title: 'Sign in', sub: 'Another account or server', icon: 'logIn', pick: signIn });
  // A library's whole listing gets the letter strip down its side and the search in the header.
  const indexed = /^\/library\/sections\/\w+\/all$/.test(page.key || '');
  grid.classList.toggle('indexed', indexed);
  $('search').hidden = !indexed;
  $('search').value = '';
  // All of a show's episodes come in season order, each season under its name.
  const allEps = /\/allLeaves$/.test(page.key || '');
  let season;
  items.forEach((item) => {
    if (allEps && item.parentIndex !== season) {
      season = item.parentIndex;
      grid.append(el('div', 'season-head', item.parentTitle || 'Season ' + season));
    }
    // A show's or season's episodes show their 16:9 stills; Recently Played keeps to posters.
    const wide = d.about && item.type === 'episode';
    const card = el('button', wide ? 'card wide' : 'card');
    const img = new Image();
    img.loading = 'lazy';
    img.onload = () => img.classList.add('in');
    if (item.thumb) img.src = wide ? still(item.thumb) : poster(item.thumb);
    const art = el('div', 'art');
    if (item.icon) art.innerHTML = ICONS[item.icon];
    else art.append(img);
    const text = label(item);
    card.append(art, el('span', '', text[0]), el('span', 'dim', text[1] ? noOrphan(String(text[1])) : ' '));
    card.onclick = () => (item.pick ? item.pick() : open(item));
    if (indexed && item.ratingKey) {
      card.dataset.letter = letterOf(item);
      card.dataset.find = fold(item.title + ' ' + (item.originalTitle || ''));
    }
    grid.append(card);
  });
  if (indexed) filter();
  else letters(false);
  if (!d.items.length && !d.about) status('Nothing here');
  focusCard(focusables()[page.at || 0]);
  requestAnimationFrame(() => grid.classList.add('in'));
}

// A show's theme tune, played once from its page and on through its seasons' pages, and stopped
// on leaving the show or playing something. ponytail: half the TV's volume; a setting if it
// sits wrong against shows.
function theme(path) {
  const a = $('theme');
  const src = path ? url(path) : '';
  if (a.getAttribute('src') === src || (!src && !a.hasAttribute('src'))) return;
  if (src) {
    a.src = src;
    a.volume = 0.5;
    a.play().catch(() => {});
  } else {
    a.pause();
    a.removeAttribute('src');
    a.load();
  }
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

// The letter a title files under: its sort title's first, "#" for anything but A to Z, so
// "The Last of Us" files under L.
function letterOf(item) {
  const c = (item.titleSort || item.title || '').charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

// The strip down a library's side: "#" and A to Z, each with titles a button that jumps to the
// first of them, the rest dim. `firsts`: each letter's first card, or false for no strip.
function letters(firsts) {
  const strip = $('letters');
  strip.innerHTML = '';
  strip.hidden = !firsts;
  if (!firsts) return;
  '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l) => {
    const b = el(firsts[l] ? 'button' : 'span', '', l);
    b.dataset.letter = l;
    if (firsts[l]) b.onclick = () => focusCard(firsts[l]);
    strip.append(b);
  });
}

// Whether a word in `text` starts with `q`, both folded; `q` may run across words: "last of".
// Punctuation counts as a word break, so "sugar" finds "(Sugar)".
const matchesWord = (text, q) => (' ' + text.replace(/[^a-z0-9]+/g, ' ')).indexOf(' ' + q.replace(/[^a-z0-9]+/g, ' ')) >= 0;

// Lower case without accents, so "pok" finds "Pokémon".
const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Shows the cards with a word in their title that starts with the search ("last" finds "The Last
// of Us", "s" doesn't), all of them when it's empty, and rebuilds the strip from what shows:
// each letter's first card, Plex listing them in sort order.
function filter() {
  const q = fold($('search').value.trim());
  const firsts = {};
  let matches = 0;
  Array.from($('grid').querySelectorAll('.card')).forEach((c) => {
    c.hidden = !!q && !matchesWord(c.dataset.find || '', q);
    if (c.hidden) return;
    matches++;
    const l = c.dataset.letter;
    if (l) firsts[l] = firsts[l] || c;
  });
  letters(firsts);
  status(matches ? '' : 'No titles match');
  $('grid').scrollTop = 0;
}

// Lights the strip's letter for the card in focus, so it shows where in the list you are.
function lightLetter(e) {
  const l = e.target.dataset.letter;
  if (l) Array.from($('letters').children).forEach((b) => b.classList.toggle('on', b.dataset.letter === l));
}

// Everything the D-pad can land on in the page: the details' buttons, the cards, the strip, then
// the search, last so a page opens on its first card. Cards the search hides are left out.
const shown = (selector) => Array.from(document.querySelectorAll(selector)).filter((b) => !b.hidden);
const focusables = () => shown('#grid button').concat(shown('#letters button'), shown('#search'));

// The D-pad scrolls the page only by moving focus, and a show's details hold nothing to focus.
// So the top row shows the page from its top, details and all; anything lower centres in view.
// The letter strip doesn't scroll, so its letters only take focus.
function focusCard(card) {
  if (!card) return;
  card.focus({ preventScroll: true });
  if (!$('grid').contains(card)) return;
  const top = card.getBoundingClientRect().top;
  if (shown('#grid button').some((b) => b.getBoundingClientRect().bottom <= top)) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if ($('grid').scrollTo) $('grid').scrollTo({ top: 0, behavior: 'smooth' });
  else $('grid').scrollTop = 0; // Chromium 56 has no Element.scrollTo
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
  // A search is cleared before the page is left, the TV's keyboard being the only other way.
  if (!$('search').hidden && $('search').value) {
    $('search').value = '';
    filter();
    return focusCard(shown('#grid button')[0]);
  }
  if (stack.length > 1) {
    stack.pop();
    show(stack[stack.length - 1]);
  }
  // On the libraries, Back does nothing: holding Back returns to TizenBrew's menu, which
  // TizenBrew handles itself (history.back() from here doesn't reach it).
}

// D-pad: focus moves to the nearest button on screen in that direction, so the details' buttons,
// a grid's short last row and the letter strip need no special cases. Left and right stay
// within what overlaps the focus top to bottom: its row, or from a letter, the cards beside it.
function move(dir) {
  const all = focusables();
  const cur = document.activeElement;
  if (all.indexOf(cur) < 0) return focusCard(all[0]);
  // Up and Down keep to the side focus is on, the strip or the page; Left and Right cross.
  const strip = $('letters');
  const side = (b) => dir === 'left' || dir === 'right' || strip.contains(b) === strip.contains(cur);
  const others = all.filter((b) => b !== cur && side(b)).map((b) => [b, b.getBoundingClientRect()]);
  focusCard(nearest(cur.getBoundingClientRect(), others, dir));
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
    const overlaps = c[1].top < from.top + from.height && c[1].top + c[1].height > from.top;
    if (along <= 1 || (across && !overlaps)) return;
    const score = along + 2 * Math.abs(across ? dy : dx);
    if (score < bestScore) [best, bestScore] = [c[0], score];
  });
  return best;
}

// `fromStart`: ignore the item's resume point. `viaPlex`: never straight off the server.
function play(item, fromStart, viaPlex) {
  const v = $('video');
  theme(null);
  const s = stream(item, (type) => v.canPlayType(type), viaPlex);
  // `tracks` stays null until the item's subtitle tracks are known; `track` -1 is off.
  const p = (playing = { item, fromStart, session: s.session, tracks: null, track: -1, cues: [] });
  playing.timer = setInterval(() => report(v.paused ? 'paused' : 'playing'), 10000);
  subtitleTracks(item).then(
    (t) => (p.tracks = t),
    () => (p.tracks = [])
  );
  requestAnimationFrame(() => drawSubtitles(p));
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
  clearTimeout(seekTimer);
  seekTo = null;
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
  $('subs').textContent = '';
  $('subs').hidden = true;
  $('menu').hidden = true;
  // A movie's page offers Resume or Play by where it was left.
  const top = stack[stack.length - 1];
  if (top && top.data && top.data.about === it) {
    top.at = focusables().indexOf(document.activeElement);
    render(top);
  }
}

// An item's own record, with its files and their streams, which listings leave out.
const metadata = async (item) => (await list('/library/metadata/' + item.ratingKey))[0] || {};

// Subtitles in a file of their own beside the video on Plex, SRT or WebVTT, as text the app
// draws, each with the file (part) it belongs to. Plex hands embedded tracks over only burned
// into the picture, re-encoding it.
function textStreams(full) {
  const out = [];
  (full.Media || []).forEach((m) =>
    (m.Part || []).forEach((part) =>
      (part.Stream || []).forEach((s) => {
        if (s.streamType === 3 && s.key && (s.codec === 'srt' || s.codec === 'vtt')) out.push({ part, stream: s });
      })
    )
  );
  return out;
}

// The item's subtitles on Plex, as { title, key }, then any found on OpenSubtitles and kept,
// as { title, text }.
async function subtitleTracks(item) {
  const onPlex = textStreams(await metadata(item)).map((x) => ({ title: x.stream.displayTitle || 'Subtitles', key: x.stream.key }));
  return onPlex.concat(savedSubtitles(item));
}

// Found subtitles live in localStorage as "subs:<ratingKey>:<title>", one per kind of track:
// picking another English result replaces the last. ponytail: kept until the storage is full,
// after which a find still shows but isn't kept; prune the oldest if that bites.
const SAVED = 'subs:';
function savedSubtitles(item) {
  const prefix = SAVED + item.ratingKey + ':';
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.indexOf(prefix) === 0) out.push({ title: k.slice(prefix.length), text: localStorage.getItem(k) });
  }
  return out;
}

// The TV's language, as two letters: "en".
const language = () => (navigator.language || 'en').split('-')[0];

// OpenSubtitles, searched through Plex: best match first, one made for this very file before
// the rest.
async function searchSubtitles(item, lang) {
  const path = '/library/metadata/' + item.ratingKey + '/subtitles';
  return rankFound((await getJson(url(path, { language: lang }))).MediaContainer.Stream || []);
}

const rankFound = (found) =>
  found.slice().sort((a, b) => !!b.perfectMatch - !!a.perfectMatch || (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));

// Keeps a subtitle `searchSubtitles` found and returns it as a track. A result downloads only
// once chosen, which has Plex fetch it in the background (~2 s), attach it to the item and select
// it. Plex keeps a found track only while it's selected, and the transcoder burns a selected
// track into the picture, re-encoding the video. So the text is taken, then the track
// unselected, which drops it again and leaves the shared server as it was.
async function downloadSubtitles(item, found) {
  const put = (path, params) =>
    fetch(url(path, params), { method: 'PUT' }).then((r) => {
      if (!r.ok) throw new Error('Plex answered ' + r.status);
    });
  const before = textStreams(await metadata(item)).map((x) => x.stream.key);
  await put('/library/metadata/' + item.ratingKey + '/subtitles', { key: found.key });
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    // The track Plex attached: one that wasn't there before, not a file beside the video.
    const added = textStreams(await metadata(item)).filter((x) => before.indexOf(x.stream.key) < 0)[0];
    if (!added) continue;
    let text;
    try {
      const r = await fetch(url(added.stream.key));
      if (!r.ok) throw new Error('Plex answered ' + r.status);
      text = await r.text();
    } finally {
      // Unselected whatever happened, so the server isn't left with it.
      await put('/library/parts/' + added.part.id, { subtitleStreamID: 0, allParts: 1 });
    }
    const title = found.displayTitle || 'Subtitles';
    try {
      localStorage.setItem(SAVED + item.ratingKey + ':' + title, text);
    } catch (e) {
      // Storage full: shown this once, not kept.
    }
    return { title, text };
  }
  throw new Error("Plex didn't finish downloading them");
}

// SRT and WebVTT, whose cues are laid out the same way: a block per cue, its times on the line
// with "-->", which skips the cue number, or a WebVTT header or note.
function parseCues(src) {
  return src
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => l.indexOf('-->') >= 0);
      if (at < 0) return null;
      const times = lines[at].split('-->');
      // WebVTT can follow the end time with cue settings: "align:start".
      const start = cueTime(times[0]);
      const end = cueTime(times[1].trim().split(/\s+/)[0]);
      // Drops styling: <i>…</i>, <font …>, and the {\an8} placement codes some SRT files carry.
      // A blank line ends a cue, so any left here is the file's own last newline.
      const text = lines
        .slice(at + 1)
        .filter((l) => l)
        .map((l) => l.replace(/<[^>]*>|\{[^}]*\}/g, ''))
        .join('\n');
      return isNaN(start) || isNaN(end) || !text.trim() ? null : { start, end, text };
    })
    .filter(Boolean);
}

// "01:02:03,456", or WebVTT's "01:02:03.456" and "02:03.456".
const cueTime = (s) =>
  s.trim().replace(',', '.').split(':').reverse().reduce((t, part, i) => t + parseFloat(part) * [1, 60, 3600][i], 0);

// The text showing `t` seconds in, cues that overlap one above the other.
// ponytail: scans every cue, ~1,500 in a film, each frame. Binary search on start if it shows.
const cuesAt = (cues, t) =>
  cues
    .filter((c) => c.start <= t && t < c.end)
    .map((c) => c.text)
    .join('\n');

// Each frame while `p` plays: timeupdate comes only about every 250 ms, too coarse for subtitles.
function drawSubtitles(p) {
  if (playing !== p) return;
  const text = cuesAt(p.cues, $('video').currentTime);
  const box = $('subs');
  if (box.textContent !== text) {
    box.textContent = text;
    box.hidden = !text;
  }
  requestAnimationFrame(() => drawSubtitles(p));
}

// Up (S on a keyboard): Off, the item's subtitle tracks, and a search of OpenSubtitles, over the
// picture as it plays, the track showing checked and focused.
function subtitleMenu() {
  const p = playing;
  if (!p.tracks) return flash('Looking for subtitles…');
  const rows = [{ text: 'Off', on: p.track < 0, pick: () => setTrack(-1) }]
    .concat(p.tracks.map((t, i) => ({ text: t.title, on: p.track === i, pick: () => setTrack(i) })))
    .concat([{ text: 'Find on OpenSubtitles…', pick: findSubtitles }]);
  showMenu(rows, p.track + 1);
}

// The menu's rows: { text, sub, on, pick }, or a line of text alone without `pick`.
function showMenu(rows, focus) {
  const list = $('menu-list');
  list.innerHTML = '';
  rows.forEach((r) => {
    if (!r.pick) return list.append(el('div', 'dim note', r.text));
    const b = el('button', r.on ? 'on' : '');
    b.innerHTML = ICONS.check;
    b.append(r.text);
    if (r.sub) b.append(el('span', 'dim sub', r.sub));
    b.onclick = r.pick;
    list.append(b);
  });
  // Where focus was in the page, to hand it back on closing.
  playing.focus = playing.focus || document.activeElement;
  $('menu').hidden = false;
  const buttons = list.querySelectorAll('button');
  if (buttons.length) (buttons[focus] || buttons[0]).focus();
}

// The search: results in the TV's language, best first. Picking one downloads it through Plex,
// keeps it, and shows it.
function findSubtitles() {
  const p = playing;
  const open = () => playing === p && !$('menu').hidden;
  showMenu([{ text: 'Searching OpenSubtitles…' }]);
  searchSubtitles(p.item, language()).then(
    (found) => {
      if (!open()) return;
      if (!found.length) return showMenu([{ text: 'Nothing found on OpenSubtitles' }]);
      const rows = found.map((f) => ({
        text: f.displayTitle || 'Subtitles',
        // The release it was made for: "Shelter.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264-KyoGo".
        sub: (f.perfectMatch ? 'Exact match · ' : '') + (f.title || ''),
        pick: () => pickFound(p, f)
      }));
      showMenu(rows);
    },
    (e) => open() && showMenu([{ text: "Couldn't search: " + e.message }])
  );
}

function pickFound(p, found) {
  closeMenu();
  flash('Downloading subtitles…', 25000);
  downloadSubtitles(p.item, found).then(
    (t) => {
      if (playing !== p) return;
      // It replaces one kept earlier of the same kind.
      p.tracks = p.tracks.filter((x) => !(x.text && x.title === t.title)).concat(t);
      setTrack(p.tracks.indexOf(t));
      flash('Subtitles: ' + t.title);
    },
    (e) => playing === p && flash(e.message)
  );
}

function closeMenu() {
  $('menu').hidden = true;
  if (playing && playing.focus) playing.focus.focus({ preventScroll: true });
}

// Up and Down move through the list, OK picks, Back or S closes it; playback carries on.
function menuKey(k) {
  const rows = Array.from($('menu-list').querySelectorAll('button'));
  const at = rows.indexOf(document.activeElement);
  const next = rows[at + ({ up: -1, down: 1 }[k] || 0)];
  if ((k === 'up' || k === 'down') && next) next.focus();
  // Only a row: with none focused, the page's own button would take the click.
  if (k === 'enter' && at >= 0) rows[at].click();
  if (k === 'back' || k === 'subs') closeMenu();
}

// Shows subtitle track `i`, or none at -1.
function setTrack(i) {
  const p = playing;
  closeMenu();
  p.track = i;
  p.cues = [];
  if (i < 0) return;
  const t = p.tracks[i];
  if (t.text) {
    p.cues = parseCues(t.text);
    return;
  }
  fetch(url(t.key))
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.text();
    })
    // Still the track asked for: not turned off or on to another since.
    .then((text) => p.tracks[p.track] === t && (p.cues = parseCues(text)))
    .catch(() => playing === p && flash("Couldn't load subtitles"));
}

// A short message over the picture, gone after `ms` (2 s) or when the next replaces it.
let flashTimer;
function flash(text, ms) {
  $('flash').textContent = text;
  $('flash').classList.add('in');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('flash').classList.remove('in'), ms || 2000);
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
  $('osd-time').textContent = clock(seekTo != null ? seekTo : v.currentTime) + ' / ' + clock(v.duration);
}

function osd() {
  time();
  $('osd').classList.add('in');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => $('osd').classList.remove('in'), 3000);
}

function playerKey(k) {
  const v = $('video');
  // The subtitle list takes the D-pad, OK and Back for itself, so Back closes the list rather
  // than the video; the media keys still work the player.
  if (!$('menu').hidden && ['up', 'down', 'left', 'right', 'enter', 'back', 'subs'].includes(k)) return menuKey(k);
  if (k === 'back' || k === 'stop') return stop();
  if (k === 'up' || k === 'subs') return subtitleMenu();
  if (k === 'enter' || k === 'playpause') v.paused ? v.play() : v.pause();
  if (k === 'play') v.play();
  if (k === 'pause') v.pause();
  const jump = { left: -10, right: 10, rew: -30, ff: 30 }[k];
  // Presses add up on the clock and seek once they stop: every seek of a file straight off the
  // server waits on the network, so seeking on each press makes the presses queue.
  if (jump) {
    seekTo = Math.max(0, Math.min((seekTo != null ? seekTo : v.currentTime) + jump, v.duration || Infinity));
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      v.currentTime = seekTo;
      seekTo = null;
    }, 600);
  }
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
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 412: 'rew', 417: 'ff', 83: 'subs'
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
  // In the search, keys type, move the caret or work the TV's keyboard: Backspace deletes rather
  // than going back, S and Space type. Down, or Back other than Backspace, returns to the cards.
  if (e.target === $('search')) {
    if (k === 'down' || (k === 'back' && e.keyCode !== 8)) {
      e.preventDefault();
      focusCard(shown('#grid button')[0]);
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
  $('grid').addEventListener('focusin', lightLetter);
  $('search').addEventListener('input', filter);
  $('backdrop').onload = () => $('backdrop').classList.add('in');
  const v = $('video');
  v.ontimeupdate = time;
  v.onended = stop;
  v.onplaying = () => playing && (playing.started = true);
  v.onerror = () => {
    const p = playing;
    stop();
    // A file the player said it could take but couldn't, before it ever played: through Plex
    // instead, which a stream with a session already is.
    if (p && !p.session && !p.started) return play(p.item, p.fromStart, true);
    status("That didn't play");
  };
  addEventListener('pagehide', stop);
  cfg.server && cfg.token ? browse() : signIn();
}

if (typeof document !== 'undefined') boot();
if (typeof module === 'object') module.exports = { cfg, url, stream, heading, clock, candidates, recentFolder, oneEachShow, nextAfter, label, timeline, facts, credits, nearest, letterOf, fold, matchesWord, parseCues, cuesAt, textStreams, rankFound, RECENT };
