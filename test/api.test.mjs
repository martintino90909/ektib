import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi, makeStore, COOKIE} from '../src/api.js';

const memKv = () => {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
  };
};

const env = {PASSCODE: 'correct horse'};
const base = 'https://ektib.example.workers.dev';
const req = (method, path, body, cookie) => new Request(base + path, {
  method,
  headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {})},
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const login = async (store) => {
  const r = await handleApi(req('POST', '/api/login', {passcode: 'correct horse'}), env, store);
  assert.equal(r.status, 200);
  return r.headers.get('Set-Cookie').split(';')[0];
};

test('progress is hidden until signed in', async () => {
  const store = makeStore(memKv());
  const r = await handleApi(req('GET', '/api/progress'), env, store);
  assert.equal(r.status, 401);
  const s = await (await handleApi(req('GET', '/api/session'), env, store)).json();
  assert.deepEqual(s, {configured: true, authed: false});
});

test('wrong passcode is refused and locks after 10 tries', async () => {
  const store = makeStore(memKv());
  for (let i = 0; i < 10; i++) {
    const r = await handleApi(req('POST', '/api/login', {passcode: 'nope'}), env, store);
    assert.equal(r.status, 401);
  }
  const r = await handleApi(req('POST', '/api/login', {passcode: 'correct horse'}), env, store);
  assert.equal(r.status, 429);
});

test('a forged cookie is refused', async () => {
  const store = makeStore(memKv());
  const r = await handleApi(req('GET', '/api/progress', undefined, `${COOKIE}=abc`), env, store);
  assert.equal(r.status, 401);
});

test('save and read back progress', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  let r = await handleApi(req('GET', '/api/progress', undefined, c), env, store);
  assert.deepEqual(await r.json(), {progress: null});
  r = await handleApi(req('PUT', '/api/progress', {xp: 15, done: {'u1-1': true}, updated: 100}, c), env, store);
  assert.equal(r.status, 200);
  r = await handleApi(req('GET', '/api/progress', undefined, c), env, store);
  assert.equal((await r.json()).progress.xp, 15);
});

test('older progress cannot overwrite newer progress', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  await handleApi(req('PUT', '/api/progress', {xp: 40, updated: 200}, c), env, store);
  const r = await handleApi(req('PUT', '/api/progress', {xp: 10, updated: 150}, c), env, store);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).progress.xp, 40);
});

test('progress without an updated time is refused', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  const r = await handleApi(req('PUT', '/api/progress', {xp: 1}, c), env, store);
  assert.equal(r.status, 400);
});

test('no passcode set means nothing is reachable', async () => {
  const store = makeStore(memKv());
  const r = await handleApi(req('GET', '/api/progress'), {}, store);
  assert.equal(r.status, 503);
});

const audioReq = (method, key, body, cookie, type = 'audio/mp4') => new Request(`${base}/api/audio/${key}`, {
  method, headers: {...(body ? {'Content-Type': type, 'X-Text': encodeURIComponent('بيت')} : {}), ...(cookie ? {Cookie: cookie} : {})}, body,
});

test('recordings save, list, play back and delete', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  const key = '0123456789abcdef';
  const bytes = new Uint8Array(2000).fill(7);
  let r = await handleApi(audioReq('PUT', key, bytes, c), env, store);
  assert.equal(r.status, 200);
  r = await handleApi(req('GET', '/api/audio', undefined, c), env, store);
  const {index} = await r.json();
  assert.equal(index[key].t, 'بيت');
  r = await handleApi(audioReq('GET', key, undefined, c), env, store);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'audio/mp4');
  assert.equal((await r.arrayBuffer()).byteLength, 2000);
  r = await handleApi(audioReq('DELETE', key, undefined, c), env, store);
  assert.equal(r.status, 200);
  r = await handleApi(audioReq('GET', key, undefined, c), env, store);
  assert.equal(r.status, 404);
});

test('recordings need a session and real audio', async () => {
  const store = makeStore(memKv());
  const key = '0123456789abcdef';
  let r = await handleApi(audioReq('PUT', key, new Uint8Array(2000)), env, store);
  assert.equal(r.status, 401);
  const c = await login(store);
  r = await handleApi(audioReq('PUT', key, new Uint8Array(2000), c, 'text/html'), env, store);
  assert.equal(r.status, 415);
  r = await handleApi(audioReq('PUT', key, new Uint8Array(2 * 1024 * 1024), c), env, store);
  assert.equal(r.status, 413);
  r = await handleApi(audioReq('GET', 'not-a-key', undefined, c), env, store);
  assert.equal(r.status, 404);
});

test('summary for the Life dashboard', async () => {
  const {summarize} = await import('../src/api.js');
  assert.deepEqual(summarize(null), {started: false});
  const now = new Date('2026-10-27T12:00:00Z');
  const p = {xp: 120, streak: 4, lastDay: '2026-10-26', today: {day: '2026-10-26', xp: 18},
    done: {'u1-1': true, 'u1-2': true}, stories: {ep1: true}, hist: {'2026-10-25': 30},
    srs: {a: {b: 4, d: now.getTime() - 1000}, b: {b: 1, d: now.getTime() + 864e5}},
    meta: {lessons: 40, stories: 12, next: {unit: 1, name: 'Tooth letters'}}, updated: 5};
  const s = summarize(p, now);
  assert.equal(s.streak, 4);
  assert.equal(s.todayXp, 0);
  assert.equal(s.practisedToday, false);
  assert.equal(s.lessonsDone, 2);
  assert.equal(s.lessonsTotal, 40);
  assert.equal(s.storiesRead, 1);
  assert.equal(s.cards, 2);
  assert.equal(s.dueNow, 1);
  assert.equal(s.strong, 1);
  assert.equal(s.days.length, 30);
  assert.deepEqual(s.days.slice(-3).map((d) => d.xp), [30, 18, 0]);
  assert.equal(summarize({...p, lastDay: '2026-10-20'}, now).streak, 0);
});
