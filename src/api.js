// API for Ektib. Kept free of Cloudflare-only imports so it can be tested in Node.
// `store` is the Durable Object stub (or a test double) with:
//   getProgress(uid?), putProgress(p, uid?), delProgress(uid), getUsers(), putUsers(users),
//   loginFailures(), noteLoginFailure(), clearLoginFailures(),
//   audioIndex(), getAudio(key), putAudio(key, type, buf, text), delAudio(key)
//
// Accounts: the owner signs in with env.PASSCODE (and keeps the original session cookie format).
// The owner can create accounts for friends; each friend has their own passcode and progress.
// Recordings are shared: everyone can play them, only the owner can add or delete them.
//
// Generated voices: with AZURE_SPEECH_KEY and AZURE_SPEECH_REGION set, any signed-in person can ask
// for a computer voice (Azure's Egyptian voices) for a letter, word or story line. It is made once,
// stored, and served whenever there is no human recording for that text.

export const COOKIE = 'ektib_session';
const SESSION_MSG = 'ektib-session-v1';
const MAX_BODY = 64 * 1024;
const MAX_FAILURES = 10;
const MAX_AUDIO = 1024 * 1024;
const AUDIO_KEY = /^\/api\/audio\/([a-f0-9]{16})$/;
const USER_PATH = /^\/api\/users\/([a-f0-9]{8})(\/passcode)?$/;
const MAX_USERS = 20;
const MAX_TTS_TEXT = 300;
const SALMA = 'ar-EG-SalmaNeural', SHAKIR = 'ar-EG-ShakirNeural';
// One preset per kind of speaker, so story characters sound different from each other.
export const TTS_PRESETS = {
  word:     {voice: SALMA,  rate: '-18%', pitch: '0%'},
  narrator: {voice: SALMA,  rate: '-10%', pitch: '-2%'},
  teita:    {voice: SALMA,  rate: '-14%', pitch: '-12%'},
  nour:     {voice: SALMA,  rate: '-4%',  pitch: '+6%'},
  woman:    {voice: SALMA,  rate: '-8%',  pitch: '-5%'},
  yousef:   {voice: SHAKIR, rate: '-6%',  pitch: '+4%'},
  saad:     {voice: SHAKIR, rate: '-14%', pitch: '-12%'},
  man:      {voice: SHAKIR, rate: '-8%',  pitch: '-4%'},
};
// Letters are spoken by name.
const LETTER_NAMES = {'ا':'ألف','ب':'باء','ت':'تاء','ث':'ثاء','ج':'جيم','ح':'حاء','خ':'خاء','د':'دال','ذ':'ذال','ر':'راء','ز':'زاي',
  'س':'سين','ش':'شين','ص':'صاد','ض':'ضاد','ط':'طاء','ظ':'ظاء','ع':'عين','غ':'غين','ف':'فاء','ق':'قاف','ك':'كاف','ل':'لام',
  'م':'ميم','ن':'نون','ه':'هاء','و':'واو','ي':'ياء','ة':'تاء مربوطة','ء':'همزة'};
const WORDS = ['falafel','mishmish','corniche','tram','basbousa','fresca','qaitbay','anfushi','sayadiya','kibda','fuul','bahari','nawwa','mashroo3','shatt','yalla'];

const enc = new TextEncoder();

const b64url = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Constant-time string compare.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const sessionToken = (passcode) => hmac(passcode, SESSION_MSG);
const userToken = async (env, id, ver) => `u.${id}.${await hmac(env.PASSCODE, `ektib-user-session:${id}:${ver}`)}`;
const passHash = (env, code) => hmac(env.PASSCODE, `ektib-user-pass:${code}`);
const randHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
export function makePasscode() {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${WORDS[r[0] % WORDS.length]}-${String(1000 + (r[1] % 9000))}`;
}
const cookieFor = (token) => `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;
// Same key the app computes for a piece of text (vowel marks, tatweel and punctuation ignored).
const plainAr = (s) => s.replace(/[\u064B-\u0652\u0670]/g, '').replace(/\u0640/g, '');
export function akey(text) {
  const s = plainAr(text).replace(/[.!؟،?,:]/g, '').replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
const escXml = (s) => s.replace(/[<>&'"]/g, (c) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'}[c]));
export const ttsReady = (env) => !!(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);
export function ssmlFor(text, preset) {
  const p = TTS_PRESETS[preset] || TTS_PRESETS.word;
  const letter = LETTER_NAMES[plainAr(text).trim()];
  const speak = letter || text.replace(/\s+([.!؟،?,:])/g, '$1');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-EG"><voice name="${p.voice}"><prosody rate="${p.rate}" pitch="${p.pitch}">${escXml(speak)}</prosody></voice></speak>`;
}
async function synthesize(env, text, preset) {
  const doFetch = env.TTS_FETCH || fetch;
  const region = String(env.AZURE_SPEECH_REGION).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = await doFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {'Ocp-Apim-Subscription-Key': String(env.AZURE_SPEECH_KEY).trim(), 'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'ektib'},
    body: ssmlFor(text, preset),
  });
  if (r.status === 429) throw Object.assign(new Error('The voice service is busy. Try again in a minute.'), {status: 429, code: 'tts_busy'});
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('The Azure speech key or region is wrong. Check them in Cloudflare.'), {status: 502, code: 'tts_key'});
  if (!r.ok) throw Object.assign(new Error(`The voice service failed (${r.status}). Try again later.`), {status: 502, code: 'tts_failed'});
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 200) throw Object.assign(new Error('The voice service sent back no audio.'), {status: 502, code: 'tts_failed'});
  return buf;
}
const cleanName = (n) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '');

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers}});

const err = (status, code, message, extra = {}) => json({error: code, message, ...extra}, status);

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) throw Object.assign(new Error('Send JSON.'), {status: 415});
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('That is too big to save.'), {status: 413});
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('That was not valid JSON.'), {status: 400}); }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Who is signed in: {id:'owner', owner:true} for the owner, {id, name} for a friend, or null.
export async function whoami(request, env, store) {
  if (!env.PASSCODE) return null;
  const got = readCookie(request, COOKIE);
  if (!got) return null;
  if (safeEqual(got, await sessionToken(env.PASSCODE))) return {id: 'owner', name: null, owner: true};
  const m = got.match(/^u\.([a-f0-9]{8})\./);
  if (!m) return null;
  const u = (await store.getUsers())[m[1]];
  if (!u || !safeEqual(got, await userToken(env, m[1], u.ver))) return null;
  return {id: m[1], name: u.name, owner: false};
}

export async function handleApi(request, env, store) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const configured = !!env.PASSCODE;

  try {
    if (path === '/api/session' && method === 'GET') {
      const me = await whoami(request, env, store);
      return json({configured, authed: !!me, user: me});
    }

    if (path === '/api/login' && method === 'POST') {
      if (!configured) return err(503, 'not_configured', 'No passcode has been set for Ektib yet.');
      if ((await store.loginFailures()) >= MAX_FAILURES) return err(429, 'locked', 'Too many wrong passcodes. Try again in an hour.');
      const body = await readJson(request);
      const tryCode = typeof body.passcode === 'string' ? body.passcode.trim() : '';
      // Compare HMACs so the comparison time doesn't depend on the passcode.
      if (safeEqual(await hmac(env.PASSCODE, tryCode), await hmac(env.PASSCODE, env.PASSCODE))) {
        await store.clearLoginFailures();
        return json({ok: true, user: {id: 'owner', name: null, owner: true}}, 200, {'Set-Cookie': cookieFor(await sessionToken(env.PASSCODE))});
      }
      const h = await passHash(env, tryCode.toLowerCase());
      const users = await store.getUsers();
      const id = Object.keys(users).find((k) => safeEqual(users[k].hash, h));
      if (!id) {
        await store.noteLoginFailure();
        return err(401, 'wrong_passcode', 'That passcode is wrong.');
      }
      await store.clearLoginFailures();
      return json({ok: true, user: {id, name: users[id].name, owner: false}}, 200, {'Set-Cookie': cookieFor(await userToken(env, id, users[id].ver))});
    }

    if (path === '/api/logout' && method === 'POST') {
      return json({ok: true}, 200, {'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`});
    }

    // Everything below needs a session.
    if (!configured) return err(503, 'not_configured', 'No passcode has been set for Ektib yet.');
    const me = await whoami(request, env, store);
    if (!me) return err(401, 'signed_out', 'Sign in to sync your progress.');
    const uid = me.owner ? undefined : me.id;

    if (path === '/api/progress' && method === 'GET') {
      return json({progress: await store.getProgress(uid)});
    }

    if (path === '/api/progress' && method === 'PUT') {
      const body = await readJson(request);
      if (!isPlainObject(body) || typeof body.updated !== 'number') return err(400, 'bad_request', 'Send the progress object with an `updated` time.');
      const cur = await store.getProgress(uid);
      // A device with older progress must not overwrite newer progress from another device.
      if (cur && typeof cur.updated === 'number' && cur.updated > body.updated) {
        return err(409, 'stale', 'Another device saved newer progress.', {progress: cur});
      }
      await store.putProgress(body, uid);
      return json({ok: true});
    }

    // Accounts for friends. Owner only.
    if (path === '/api/users' || USER_PATH.test(path)) {
      if (!me.owner) return err(403, 'owner_only', 'Only the owner can manage accounts.');
      const users = await store.getUsers();
      let h0 = null; // hash of the passcode pickCode settled on
      const taken = (code, h) => code === env.PASSCODE.trim().toLowerCase() || Object.values(users).some((u) => u.hash === h);
      const pickCode = async (wanted) => {
        let code = typeof wanted === 'string' ? wanted.trim().toLowerCase() : '';
        if (code && (code.length < 6 || code.length > 64)) throw Object.assign(new Error('Passcodes need 6 to 64 characters.'), {status: 400});
        for (let i = 0; i < 20; i++) {
          if (!code) code = makePasscode();
          h0 = await passHash(env, code);
          if (!taken(code, h0)) return code;
          if (wanted) throw Object.assign(new Error('That passcode is already in use. Pick another.'), {status: 409});
          code = '';
        }
        throw new Error('no passcode');
      };

      if (path === '/api/users' && method === 'GET') {
        const list = await Promise.all(Object.entries(users).map(async ([id, u]) => {
          const p = await store.getProgress(id);
          return {id, name: u.name, created: u.created, xp: p ? Number(p.xp) || 0 : 0,
            lessonsDone: p ? Object.values(p.done || {}).filter(Boolean).length : 0, lastActive: p ? Number(p.updated) || null : null};
        }));
        list.sort((a, b) => a.created - b.created);
        return json({users: list});
      }
      if (path === '/api/users' && method === 'POST') {
        const body = await readJson(request);
        const name = cleanName(body.name);
        if (!name || name.length > 40) return err(400, 'bad_name', 'Give the account a name of up to 40 characters.');
        if (Object.keys(users).length >= MAX_USERS) return err(400, 'too_many', `You can have up to ${MAX_USERS} friend accounts.`);
        if (Object.values(users).some((u) => u.name.toLowerCase() === name.toLowerCase())) return err(409, 'name_taken', `There is already an account called ${name}.`);
        const code = await pickCode(body.passcode);
        const id = randHex(4);
        users[id] = {name, hash: h0, ver: 1, created: Date.now()};
        await store.putUsers(users);
        return json({user: {id, name, created: users[id].created, xp: 0, lessonsDone: 0, lastActive: null}, passcode: code}, 201);
      }
      const um = path.match(USER_PATH);
      if (um) {
        const id = um[1], u = users[id];
        if (!u) return err(404, 'not_found', 'That account doesn’t exist.');
        if (um[2] && method === 'POST') {
          const body = await readJson(request);
          const code = await pickCode(body.passcode);
          u.hash = h0; u.ver = (u.ver || 1) + 1;
          await store.putUsers(users);
          return json({ok: true, passcode: code});
        }
        if (!um[2] && method === 'DELETE') {
          delete users[id];
          await store.putUsers(users);
          await store.delProgress(id);
          return json({ok: true});
        }
      }
      return err(405, 'bad_method', 'That doesn’t work on accounts.');
    }

    // Recordings of words and story lines, keyed by a hash of their text.
    if (path === '/api/audio' && method === 'GET') {
      return json({index: await store.audioIndex(), tts: await store.ttsIndex(), ttsReady: ttsReady(env)});
    }

    // Make (or return the stored) computer voice for a piece of Arabic text.
    if (path === '/api/tts' && method === 'POST') {
      if (!ttsReady(env)) return err(503, 'tts_off', 'Computer voices aren’t set up yet.');
      const body = await readJson(request);
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
      const preset = typeof body.voice === 'string' && TTS_PRESETS[body.voice] ? body.voice : 'word';
      if (!text || text.length > MAX_TTS_TEXT || !/[\u0621-\u064A]/.test(text)) return err(400, 'bad_text', 'Send some Arabic text, up to 300 characters.');
      const key = akey(text);
      const have = (await store.ttsIndex())[key];
      if (have && have.p === preset) return json({key, ts: have.ts});
      try {
        const buf = await synthesize(env, text, preset);
        const entry = await store.putTts(key, buf, preset, plainAr(text).slice(0, 300));
        return json({key, ts: entry.ts});
      } catch (e) {
        if (e && e.code) return err(e.status, e.code, e.message);
        return err(502, 'tts_failed', 'Couldn’t reach the voice service. Try again later.');
      }
    }
    const am = path.match(AUDIO_KEY);
    if (am) {
      const key = am[1];
      if (method === 'GET') {
        const a = (await store.getAudio(key)) || (await store.getTts(key));
        if (!a) return err(404, 'not_found', 'There is no recording for that yet.');
        return new Response(a.data, {headers: {'Content-Type': a.type, 'Cache-Control': 'private, max-age=31536000, immutable'}});
      }
      if ((method === 'PUT' || method === 'DELETE') && !me.owner) return err(403, 'owner_only', 'Only the owner can add or remove recordings.');
      if (method === 'PUT') {
        const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
        if (!/^audio\/[a-z0-9.+-]+$/.test(type)) return err(415, 'bad_type', 'Send an audio recording.');
        const buf = await request.arrayBuffer();
        if (buf.byteLength > MAX_AUDIO) return err(413, 'too_big', 'That recording is too long. Keep it under a few seconds.');
        if (buf.byteLength < 100) return err(400, 'empty', 'That recording is empty.');
        let text = '';
        try { text = decodeURIComponent(request.headers.get('X-Text') || '').slice(0, 300); } catch {}
        const entry = await store.putAudio(key, type, buf, text);
        return json({ok: true, ts: entry.ts});
      }
      if (method === 'DELETE') { await store.delAudio(key); return json({ok: true}); }
      return err(405, 'bad_method', 'Use GET, PUT or DELETE.');
    }

    return err(404, 'not_found', 'No such API route.');
  } catch (e) {
    if (e && e.status) return err(e.status, 'bad_request', e.message);
    return err(500, 'server_error', 'Something went wrong on the server. Try again.');
  }
}

// Logic shared by the Durable Object and the tests: operates on a key-value `kv`
// with async get/put/delete like Durable Object storage.
export function makeStore(kv) {
  const FAIL = 'auth:failures';
  const HOUR = 3600 * 1000;
  return {
    async getProgress(uid) { return (await kv.get(uid ? 'progress:' + uid : 'progress')) || null; },
    async putProgress(p, uid) { await kv.put(uid ? 'progress:' + uid : 'progress', p); return true; },
    async delProgress(uid) { if (uid) await kv.delete('progress:' + uid); return true; },
    async getUsers() { return (await kv.get('users')) || {}; },
    async putUsers(u) { await kv.put('users', u); return true; },
    async loginFailures() {
      const f = await kv.get(FAIL);
      if (!f || Date.now() - f.since > HOUR) return 0;
      return f.count;
    },
    async noteLoginFailure() {
      const f = await kv.get(FAIL);
      const fresh = !f || Date.now() - f.since > HOUR;
      await kv.put(FAIL, fresh ? {count: 1, since: Date.now()} : {count: f.count + 1, since: f.since});
    },
    async clearLoginFailures() { await kv.delete(FAIL); },
    async audioIndex() { return (await kv.get('audioidx')) || {}; },
    async ttsIndex() { return (await kv.get('ttsidx')) || {}; },
    async getTts(key) { return (await kv.get('tts:' + key)) || null; },
    async putTts(key, buf, preset, text) {
      await kv.put('tts:' + key, {type: 'audio/mpeg', data: buf});
      const idx = (await kv.get('ttsidx')) || {};
      idx[key] = {p: preset, ts: Date.now(), t: text};
      await kv.put('ttsidx', idx);
      return idx[key];
    },
    async getAudio(key) { return (await kv.get('audio:' + key)) || null; },
    async putAudio(key, type, buf, text) {
      await kv.put('audio:' + key, {type, data: buf});
      const idx = (await kv.get('audioidx')) || {};
      idx[key] = {t: text, ts: Date.now()};
      await kv.put('audioidx', idx);
      return idx[key];
    },
    async delAudio(key) {
      await kv.delete('audio:' + key);
      const idx = (await kv.get('audioidx')) || {};
      delete idx[key];
      await kv.put('audioidx', idx);
      return true;
    },
  };
}

// UK date as YYYY-MM-DD.
export function londonDay(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// A small read-only summary of progress for the Life dashboard (no lesson content, no recordings).
export function summarize(p, now = new Date()) {
  if (!p) return {started: false};
  const today = londonDay(now);
  const yesterday = londonDay(new Date(now.getTime() - 864e5));
  const srs = p.srs && typeof p.srs === 'object' ? Object.values(p.srs) : [];
  const t = now.getTime();
  const hist = p.hist && typeof p.hist === 'object' ? {...p.hist} : {};
  if (p.today && p.today.day && !hist[p.today.day] && p.today.xp) hist[p.today.day] = p.today.xp;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = londonDay(new Date(t - i * 864e5));
    days.push({day: d, xp: Number(hist[d]) || 0});
  }
  const meta = p.meta || {};
  return {
    started: true,
    xp: Number(p.xp) || 0,
    todayXp: p.today && p.today.day === today ? Number(p.today.xp) || 0 : 0,
    streak: p.lastDay === today || p.lastDay === yesterday ? Number(p.streak) || 0 : 0,
    practisedToday: p.lastDay === today,
    lessonsDone: Object.values(p.done || {}).filter(Boolean).length,
    lessonsTotal: Number(meta.lessons) || null,
    storiesRead: Object.values(p.stories || {}).filter(Boolean).length,
    storiesTotal: Number(meta.stories) || null,
    cards: srs.length,
    dueNow: srs.filter((c) => c && c.d <= t).length,
    strong: srs.filter((c) => c && c.b >= 4).length,
    next: meta.next || null,
    days,
    updated: Number(p.updated) || null,
  };
}
