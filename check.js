// Run with `node check.js`: the playback choice and labels, away from any DOM or Plex server.
const assert = require('assert');
const { cfg, url, stream, heading, clock, candidates, recentFolders, oneEachShow, nextAfter, label, timeline, facts, credits, nearest, letterOf, fold, matchesWord, parseCues, cuesAt, textStreams, rankFound, titleLines, RECENT, ADDED } = require('./app.js');

Object.assign(cfg, { server: 'http://plex:32400', token: 't' });
const item = (container, codec, audio, profile) => ({
  ratingKey: '7',
  Media: [{ videoCodec: codec, audioCodec: audio, videoProfile: profile, Part: [{ key: '/p', container }] }]
});
// A player like desktop Chrome on a Mac: H.264 and HEVC, AAC but not AC-3.
const asked = [];
const chrome = (type) => (asked.push(type), /ac-3|ec-3/.test(type) ? '' : 'probably');
const tvPlayer = () => 'probably';

const direct = stream(item('mp4', 'h264', 'aac'), chrome);
assert.equal(direct.session, undefined);
assert.ok(direct.src.startsWith('http://plex:32400/p?X-Plex-Token=t'));
// HEVC in MP4 plays straight off the server too, asked for as Main 10 when it's 10-bit.
assert.equal(stream(item('mp4', 'hevc', 'aac', 'main 10'), chrome).session, undefined);
assert.equal(asked[asked.length - 1], 'video/mp4; codecs="hvc1.2.4.L153.B0, mp4a.40.2"');
// The TV plays AC-3 sound; Chrome would play it silent, so Plex converts it.
assert.equal(stream(item('mp4', 'hevc', 'eac3'), tvPlayer).session, undefined);
// MKV too, asked for as Matroska.
assert.equal(stream(item('mkv', 'hevc', 'aac'), chrome).session, undefined);
assert.equal(asked[asked.length - 1], 'video/x-matroska; codecs="hvc1.1.6.L153.B0, mp4a.40.2"');

// Through Plex: sound or video the player can't take, a container it isn't asked about, DTS
// sound the app has no name for, a player that says no to Matroska, and a retry via Plex.
const noMkv = (type) => (/matroska/.test(type) ? '' : 'probably');
const viaPlex = [
  stream(item('mp4', 'hevc', 'eac3'), chrome),
  stream(item('avi', 'h264', 'aac'), chrome),
  stream(item('mkv', 'hevc', 'dca'), tvPlayer),
  stream(item('mkv', 'hevc', 'aac'), noMkv),
  stream(item('mp4', 'h264', 'aac'), chrome, true),
  stream(item('mp4', 'vc1', 'aac'), chrome)
];
for (const hls of viaPlex) {
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

// Movie and TV libraries open on Recently Played and Recently Added; not inside either folder, nor in a show's seasons.
const tv = recentFolders('/library/sections/2/all', 'show');
assert.equal(tv[0].key, '/library/sections/2/all?type=4&' + RECENT);
assert.equal(tv[1].key, '/library/sections/2/all?type=4&' + ADDED);
assert.ok(recentFolders('/library/sections/1/all', 'movie')[1].key.includes('type=1&'));
assert.equal(recentFolders('/library/sections/3/all', 'artist'), null);
assert.equal(recentFolders(tv[0].key, 'show'), null);
assert.equal(recentFolders(tv[1].key, 'show'), null);
assert.equal(recentFolders('/library/metadata/7/children', 'show'), null);
// The filter survives url() re-encoding the query.
assert.equal(new URL(url(tv[0].key)).searchParams.get('lastViewedAt>>'), '0');
assert.equal(new URL(url(tv[1].key)).searchParams.get('sort'), 'addedAt:desc');

const ep = (show, title) => ({ title, grandparentRatingKey: show, grandparentTitle: 'Show ' + show, grandparentThumb: '/t/' + show });
const once = oneEachShow([ep('1', 'a'), { title: 'Movie' }, ep('1', 'b'), ep('2', 'c')]);
assert.deepEqual(once.map((i) => i.label || i.title), ['Show 1', 'Movie', 'Show 2']);
assert.equal(once[0].thumb, '/t/1');

// Card text: a season's episodes by number, Recently Played's under the show's name.
const engram = { type: 'episode', title: 'The Engram', grandparentTitle: 'The Terminal List', parentIndex: 1, index: 2 };
assert.deepEqual(label(engram), ['Episode 2', 'The Engram']);
assert.deepEqual(label(Object.assign({ label: 'The Terminal List' }, engram)), ['The Terminal List', 'S1 · E2 · The Engram']);
assert.deepEqual(label({ title: 'Heat', year: 1995 }), ['Heat', 1995]);
assert.deepEqual(label({ title: 'Sign in', sub: 'Another account or server' }), ['Sign in', 'Another account or server']);

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

// The letter strip: Right from the right-hand card reaches the letter beside it, Up and Down
// keep to the strip, and Left goes back to the card beside the letter, though their middles
// aren't level.
const strip = [['L', { left: 600, top: 30, width: 40, height: 30 }], ['M', { left: 600, top: 62, width: 40, height: 30 }]];
const withStrip = grid.concat(strip);
assert.equal(nearest(grid[2][1], withStrip.filter((g) => g[0] !== 'c'), 'right'), 'L');
assert.equal(nearest(strip[0][1], withStrip.filter((g) => g[0] !== 'L'), 'down'), 'M');
assert.equal(nearest(strip[1][1], withStrip.filter((g) => g[0] !== 'M'), 'left'), 'c');

// Letters file under the sort title; anything but A to Z under #.
assert.equal(letterOf({ title: 'The Last of Us', titleSort: 'Last of Us' }), 'L');
assert.equal(letterOf({ title: 'heat' }), 'H');
assert.equal(letterOf({ title: '28 Days Later' }), '#');
assert.equal(letterOf({ title: 'Élite' }), '#');

// Subtitles: SRT with a byte-order mark, tags and placement codes; WebVTT with a note, cue
// settings and overlapping cues. The Mac's subs.rs test, ported.
const srt =
  '﻿1\r\n00:00:30,781 --> 00:00:33,659\r\n<i>Next entertainment</i>\r\nworld presents\r\n\r\n' +
  '2\r\n00:01:02,000 --> 01:00:00,500\r\n{\\an8}Up top\r\n';
let cues = parseCues(srt);
assert.equal(cues.length, 2);
assert.equal(cuesAt(cues, 31), 'Next entertainment\nworld presents');
assert.equal(cuesAt(cues, 33.7), '');
assert.equal(cuesAt(cues, 3600), 'Up top');
cues = parseCues('WEBVTT\n\nNOTE made by hand\n\n00:05.000 --> 00:07.250 align:start\nHello\n\n00:06.000 --> 00:08.000\nThere\n');
assert.equal(cuesAt(cues, 6.5), 'Hello\nThere');
assert.equal(cuesAt(cues, 7.5), 'There');

// Plex's text subtitle tracks, each with its file; embedded and image tracks left out.
const full = {
  Media: [{ Part: [{ id: 5, Stream: [
    { streamType: 3, key: '/library/streams/1', codec: 'srt' },
    { streamType: 3, codec: 'subrip' },
    { streamType: 3, key: '/library/streams/2', codec: 'pgs' },
    { streamType: 2, key: '/x', codec: 'aac' }
  ] }] }]
};
assert.deepEqual(textStreams(full).map((x) => [x.part.id, x.stream.key]), [[5, '/library/streams/1']]);
assert.deepEqual(textStreams({}), []);

// OpenSubtitles results: an exact match first, then by score.
const ranked = rankFound([{ key: 'a', score: '9' }, { key: 'b', score: '3', perfectMatch: '1' }, { key: 'c', score: '12' }, { key: 'd' }]);
assert.deepEqual(ranked.map((f) => f.key), ['b', 'c', 'a', 'd']);

// Search matches the start of a word, ignoring case, accents and punctuation.
const finds = (title, q) => matchesWord(fold(title), fold(q));
assert.ok(finds('The Last of Us', 'last'));
assert.ok(finds('The Last of Us', 'last of'));
assert.ok(!finds('The Last of Us', 's'));
assert.ok(finds('Pokémon', 'POK'));
assert.ok(finds('Sugar (2024)', '2024'));
assert.ok(finds("Tom Clancy's Jack Ryan", 'jack'));
assert.ok(!finds('Westworld', 'world'));

// Titles set as posters set them: "The", or all up to a colon, small over the rest, long titles
// balanced over lines, never breaking after a little word. Small lines in lower case here.
const set = (t) => titleLines(t).map((l) => (l.small ? l.text.toLowerCase() : l.text)).join(' / ');
assert.equal(set('The Last of Us'), 'the / Last of Us');
assert.equal(set('House of the Dragon'), 'House of the Dragon');
assert.equal(set('Silo'), 'Silo');
assert.equal(set('The'), 'The');
assert.equal(set("Tom Clancy's Jack Ryan"), "Tom Clancy's Jack Ryan");
assert.equal(set('Star Wars: The Clone Wars'), 'star wars: / The Clone Wars');
assert.equal(set('Mission: Impossible'), 'mission: / Impossible');
assert.equal(set('Ash vs Evil Dead:'), 'Ash vs Evil Dead:');
assert.equal(set('The Lord of the Rings: The Return of the King'), 'the lord of the rings: / The Return of the King');
assert.equal(set('Everything Everywhere All at Once'), 'Everything Everywhere / All at Once');

console.log('ok');
