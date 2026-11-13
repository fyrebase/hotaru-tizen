// Run with `node check.js`: the playback choice and labels, away from any DOM or Plex server.
const assert = require('assert');
const { cfg, url, stream, heading, clock, candidates, recentFolder, oneEachShow, nextAfter, label, timeline, facts, credits, nearest, RECENT } = require('./app.js');

Object.assign(cfg, { server: 'http://plex:32400', token: 't' });
const item = (container, codec) => ({ ratingKey: '7', Media: [{ videoCodec: codec, Part: [{ key: '/p', container }] }] });

const direct = stream(item('mp4', 'h264'));
assert.equal(direct.session, undefined);
assert.ok(direct.src.startsWith('http://plex:32400/p?X-Plex-Token=t'));

for (const [container, codec] of [['mp4', 'hevc'], ['mkv', 'h264']]) {
  const hls = stream(item(container, codec));
  assert.ok(hls.session);
  const u = new URL(hls.src);
  assert.equal(u.pathname, '/video/:/transcode/universal/start.m3u8');
  assert.equal(u.searchParams.get('path'), '/library/metadata/7');
  assert.equal(u.searchParams.get('session'), hls.session);
}

assert.deepEqual(heading({ title: 'The Engram', grandparentTitle: 'The Terminal List', parentIndex: 1, index: 1 }), [
  'The Terminal List',
  'S1 · E1 · The Engram'
]);
assert.deepEqual(heading({ title: 'Heat', year: 1995 }), ['Heat', 1995]);
assert.equal(clock(3725), '1:02:05');
assert.equal(clock(65), '1:05');

const conn = (protocol, uri, local, relay) => ({ protocol, uri, address: '10.0.0.2', port: 32400, local, relay });
assert.deepEqual(
  candidates([
    conn('https', 'https://relay', false, true),
    conn('https', 'https://remote', false, false),
    conn('https', 'https://local', true, false)
  ]),
  ['https://local', 'http://10.0.0.2:32400', 'https://remote', 'https://relay']
);

// Movie and TV libraries open on Recently Played; not inside the folder itself, nor in a show's seasons.
const tv = recentFolder('/library/sections/2/all', 'show');
assert.equal(tv.key, '/library/sections/2/all?type=4&' + RECENT);
assert.ok(recentFolder('/library/sections/1/all', 'movie').key.includes('type=1&'));
assert.equal(recentFolder('/library/sections/3/all', 'artist'), null);
assert.equal(recentFolder(tv.key, 'show'), null);
assert.equal(recentFolder('/library/metadata/7/children', 'show'), null);
// The filter survives url() re-encoding the query.
assert.equal(new URL(url(tv.key)).searchParams.get('lastViewedAt>>'), '0');

const ep = (show, title) => ({ title, grandparentRatingKey: show, grandparentTitle: 'Show ' + show, grandparentThumb: '/t/' + show });
const once = oneEachShow([ep('1', 'a'), { title: 'Movie' }, ep('1', 'b'), ep('2', 'c')]);
assert.deepEqual(once.map((i) => i.label || i.title), ['Show 1', 'Movie', 'Show 2']);
assert.equal(once[0].thumb, '/t/1');

// Card text: a season's episodes by number, Recently Played's under the show's name.
const engram = { type: 'episode', title: 'The Engram', grandparentTitle: 'The Terminal List', parentIndex: 1, index: 2 };
assert.deepEqual(label(engram), ['Episode 2', 'The Engram']);
assert.deepEqual(label(Object.assign({ label: 'The Terminal List' }, engram)), ['The Terminal List', 'S1 · E2 · The Engram']);
assert.deepEqual(label({ title: 'Heat', year: 1995 }), ['Heat', 1995]);

// The episode after a finished one; none past the last, or if it's missing from the show.
const eps = [{ ratingKey: '1' }, { ratingKey: '2' }];
assert.equal(nextAfter(eps, { ratingKey: '1' }).ratingKey, '2');
assert.equal(nextAfter(eps, { ratingKey: '2' }), null);
assert.equal(nextAfter(eps, { ratingKey: '9' }), null);

// Progress reports name the item, its state, and whole milliseconds.
const t = new URL(timeline({ ratingKey: '7', duration: 2400000 }, 'paused', 61234.5)).searchParams;
assert.deepEqual(
  ['ratingKey', 'key', 'state', 'time', 'duration'].map((k) => t.get(k)),
  ['7', '/library/metadata/7', 'paused', '61235', '2400000']
);

// A page's facts suit the kind of item, as on the Mac.
const genres = ['Family', 'Comedy', 'Fantasy', 'Science Fiction'].map((tag) => ({ tag }));
const movie = { type: 'movie', year: 1987, contentRating: 'PG', duration: 6389387, audienceRating: 6.44, Genre: genres };
assert.equal(facts(movie), '1987 · PG · 1h 46m · ★ 6.4 · Family, Comedy, Fantasy');
assert.equal(facts({ type: 'show', childCount: 1, duration: 2400000 }), '1 season');
assert.equal(facts({ type: 'season', leafCount: 9 }), '9 episodes');
assert.equal(facts({ type: 'season', leafCount: 9, viewedLeafCount: 4 }), '4 of 9 watched');
assert.equal(credits({ studio: 'Amblin', Director: [{ tag: 'A' }], Role: [] }), 'Amblin  ·  Directed by A');
assert.equal(credits({}), '');

// The D-pad: across a row before down to the next, a short last row's nearest card, and
// nothing past the end of a row.
const box = (x, y) => ({ left: x, top: y, width: 100, height: 100 });
const grid = [['a', box(0, 0)], ['b', box(200, 0)], ['c', box(400, 0)], ['d', box(0, 200)]];
const from = (i, dir) => nearest(grid[i][1], grid.filter((g, j) => j !== i), dir);
assert.equal(from(0, 'right'), 'b');
assert.equal(from(2, 'down'), 'd');
assert.equal(from(3, 'up'), 'a');
assert.equal(from(2, 'right'), null);
assert.equal(from(3, 'right'), null);

console.log('ok');
