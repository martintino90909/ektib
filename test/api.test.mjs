import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi, makeStore, COOKIE, akey, ssmlFor} from '../src/api.js';

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
  assert.deepEqual(s, {configured: true, authed: false, user: null});
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

// ---------- Friend accounts ----------
const jreq = (method, path, body, cookie) => req(method, path, body, cookie);
const makeFriend = async (store, owner, name = 'Liem', passcode) => {
  const r = await handleApi(jreq('POST', '/api/users', {name, ...(passcode ? {passcode} : {})}, owner), env, store);
  assert.equal(r.status, 201);
  return r.json();
};
const loginAs = async (store, passcode) => {
  const r = await handleApi(req('POST', '/api/login', {passcode}), env, store);
  return {status: r.status, cookie: (r.headers.get('Set-Cookie') || '').split(';')[0], body: await r.json()};
};

test('owner creates a friend who signs in with their own passcode', async () => {
  const store = makeStore(memKv());
  const owner = await login(store);
  const {user, passcode} = await makeFriend(store, owner);
  assert.match(passcode, /^[a-z0-9]+-\d{4}$/);
  const f = await loginAs(store, passcode);
  assert.equal(f.status, 200);
  assert.equal(f.body.user.name, 'Liem');
  const s = await (await handleApi(req('GET', '/api/session', undefined, f.cookie), env, store)).json();
  assert.deepEqual(s.user, {id: user.id, name: 'Liem', owner: false});
});

test('friend and owner keep separate progress', async () => {
  const store = makeStore(memKv());
  const owner = await login(store);
  await handleApi(req('PUT', '/api/progress', {xp: 500, updated: 10}, owner), env, store);
  const {passcode} = await makeFriend(store, owner);
  const f = await loginAs(store, passcode);
  let r = await handleApi(req('GET', '/api/progress', undefined, f.cookie), env, store);
  assert.deepEqual(await r.json(), {progress: null});
  await handleApi(req('PUT', '/api/progress', {xp: 7, updated: 20}, f.cookie), env, store);
  r = await handleApi(req('GET', '/api/progress', undefined, owner), env, store);
  assert.equal((await r.json()).progress.xp, 500);
  assert.equal((await store.getProgress()).xp, 500); // the Life dashboard summary still reads the owner's
  r = await handleApi(req('GET', '/api/users', undefined, owner), env, store);
  assert.equal((await r.json()).users[0].xp, 7);
});

test('friends cannot manage accounts or record audio', async () => {
  const store = makeStore(memKv());
  const owner = await login(store);
  const {passcode} = await makeFriend(store, owner);
  const f = await loginAs(store, passcode);
  let r = await handleApi(req('GET', '/api/users', undefined, f.cookie), env, store);
  assert.equal(r.status, 403);
  r = await handleApi(jreq('POST', '/api/users', {name: 'Sneaky'}, f.cookie), env, store);
  assert.equal(r.status, 403);
  r = await handleApi(audioReq('PUT', '0123456789abcdef', new Uint8Array(2000), f.cookie), env, store);
  assert.equal(r.status, 403);
  r = await handleApi(req('GET', '/api/audio', undefined, f.cookie), env, store);
  assert.equal(r.status, 200);
});

test('a new passcode signs the friend out everywhere; removing them deletes their progress', async () => {
  const store = makeStore(memKv());
  const owner = await login(store);
  const {user, passcode} = await makeFriend(store, owner);
  const f = await loginAs(store, passcode);
  await handleApi(req('PUT', '/api/progress', {xp: 3, updated: 5}, f.cookie), env, store);
  let r = await handleApi(jreq('POST', `/api/users/${user.id}/passcode`, {}, owner), env, store);
  const fresh = (await r.json()).passcode;
  assert.notEqual(fresh, passcode);
  r = await handleApi(req('GET', '/api/progress', undefined, f.cookie), env, store);
  assert.equal(r.status, 401);
  assert.equal((await loginAs(store, passcode)).status, 401);
  const f2 = await loginAs(store, fresh);
  r = await handleApi(req('GET', '/api/progress', undefined, f2.cookie), env, store);
  assert.equal((await r.json()).progress.xp, 3);
  r = await handleApi(req('DELETE', `/api/users/${user.id}`, undefined, owner), env, store);
  assert.equal(r.status, 200);
  r = await handleApi(req('GET', '/api/progress', undefined, f2.cookie), env, store);
  assert.equal(r.status, 401);
  assert.equal(await store.getProgress(user.id), null);
});

test('account names and chosen passcodes are checked', async () => {
  const store = makeStore(memKv());
  const owner = await login(store);
  let r = await handleApi(jreq('POST', '/api/users', {name: '  '}, owner), env, store);
  assert.equal(r.status, 400);
  await makeFriend(store, owner, 'Alex', 'secret-alex');
  r = await handleApi(jreq('POST', '/api/users', {name: 'alex'}, owner), env, store);
  assert.equal(r.status, 409);
  r = await handleApi(jreq('POST', '/api/users', {name: 'Sam', passcode: 'secret-alex'}, owner), env, store);
  assert.equal(r.status, 409);
  r = await handleApi(jreq('POST', '/api/users', {name: 'Sam', passcode: 'correct horse'}, owner), env, store);
  assert.equal(r.status, 409);
  assert.equal((await loginAs(store, 'SECRET-ALEX')).status, 200);
});

// ---------- Generated voices ----------
const fakeAzure = () => {
  const calls = [];
  const f = async (url, init) => { calls.push({url, init}); return new Response(new Uint8Array(4000).fill(1), {status: 200, headers: {'Content-Type': 'audio/mpeg'}}); };
  return {calls, f};
};
const ttsEnv = (f) => ({...env, AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'UK South', TTS_FETCH: f});

test('voices are made once, stored and served when there is no recording', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  const {calls, f} = fakeAzure();
  const e = ttsEnv(f);
  let r = await handleApi(req('POST', '/api/tts', {text: 'يوسف ! حبيبي !', voice: 'teita'}, c), e, store);
  assert.equal(r.status, 200);
  const {key} = await r.json();
  assert.equal(key, akey('يوسف حبيبي'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/uksouth\.tts\.speech\.microsoft\.com\//);
  assert.match(calls[0].init.body, /ar-EG-SalmaNeural/);
  assert.match(calls[0].init.body, /يوسف! حبيبي!/);
  r = await handleApi(req('POST', '/api/tts', {text: 'يوسف ! حبيبي !', voice: 'teita'}, c), e, store);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1); // reused, not made again
  r = await handleApi(req('GET', '/api/audio', undefined, c), e, store);
  const idx = await r.json();
  assert.equal(idx.ttsReady, true);
  assert.equal(idx.tts[key].p, 'teita');
  r = await handleApi(audioReq('GET', key, undefined, c), e, store);
  assert.equal(r.headers.get('Content-Type'), 'audio/mpeg');
  // A human recording wins over the computer voice.
  await handleApi(audioReq('PUT', key, new Uint8Array(2000), c), e, store);
  r = await handleApi(audioReq('GET', key, undefined, c), e, store);
  assert.equal(r.headers.get('Content-Type'), 'audio/mp4');
});

test('letters are spoken by name; friends can make voices; it is off without a key', async () => {
  assert.match(ssmlFor('ق', 'word'), />قاف</);
  assert.match(ssmlFor('كَتَب', 'word'), /كَتَب/);
  assert.match(ssmlFor('a<b', 'saad'), /a&lt;b/);
  assert.match(ssmlFor('a', 'saad'), /ar-EG-ShakirNeural/);
  const store = makeStore(memKv());
  const owner = await login(store);
  let r = await handleApi(req('POST', '/api/tts', {text: 'بيت'}, owner), env, store);
  assert.equal(r.status, 503);
  r = await handleApi(req('GET', '/api/audio', undefined, owner), env, store);
  assert.equal((await r.json()).ttsReady, false);
  const {passcode} = await makeFriend(store, owner);
  const fcookie = (await loginAs(store, passcode)).cookie;
  const {f} = fakeAzure();
  r = await handleApi(req('POST', '/api/tts', {text: 'بيت'}, fcookie), ttsEnv(f), store);
  assert.equal(r.status, 200);
  r = await handleApi(req('POST', '/api/tts', {text: 'hello'}, fcookie), ttsEnv(f), store);
  assert.equal(r.status, 400);
  r = await handleApi(req('POST', '/api/tts', {text: 'بيت'}), ttsEnv(f), store);
  assert.equal(r.status, 401);
});

test('voice service errors come back clearly', async () => {
  const store = makeStore(memKv());
  const c = await login(store);
  const busy = async () => new Response('', {status: 429});
  let r = await handleApi(req('POST', '/api/tts', {text: 'بيت'}, c), ttsEnv(busy), store);
  assert.equal(r.status, 429);
  const bad = async () => new Response('', {status: 401});
  r = await handleApi(req('POST', '/api/tts', {text: 'بيت'}, c), ttsEnv(bad), store);
  assert.equal((await r.json()).error, 'tts_key');
});
