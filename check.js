// Run with `node check.js`: the playback choice and labels, away from any DOM or Plex server.
const assert = require('assert');
const { cfg, stream, heading, clock, candidates } = require('./app.js');

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

console.log('ok');
