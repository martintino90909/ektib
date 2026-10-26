// API for Ektib. Kept free of Cloudflare-only imports so it can be tested in Node.
// `store` is the Durable Object stub (or a test double) with:
//   getProgress(), putProgress(p), loginFailures(), noteLoginFailure(), clearLoginFailures(),
//   audioIndex(), getAudio(key), putAudio(key, type, buf, text), delAudio(key)

export const COOKIE = 'ektib_session';
const SESSION_MSG = 'ektib-session-v1';
const MAX_BODY = 64 * 1024;
const MAX_FAILURES = 10;
const MAX_AUDIO = 1024 * 1024;
const AUDIO_KEY = /^\/api\/audio\/([a-f0-9]{16})$/;

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

export async function isAuthed(request, env) {
  if (!env.PASSCODE) return false;
  const got = readCookie(request, COOKIE);
  return !!got && safeEqual(got, await sessionToken(env.PASSCODE));
}

export async function handleApi(request, env, store) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const configured = !!env.PASSCODE;

  try {
    if (path === '/api/session' && method === 'GET') {
      return json({configured, authed: await isAuthed(request, env)});
    }

    if (path === '/api/login' && method === 'POST') {
      if (!configured) return err(503, 'not_configured', 'No passcode has been set for Ektib yet.');
      if ((await store.loginFailures()) >= MAX_FAILURES) return err(429, 'locked', 'Too many wrong passcodes. Try again in an hour.');
      const body = await readJson(request);
      const tryCode = typeof body.passcode === 'string' ? body.passcode : '';
      // Compare HMACs so the comparison time doesn't depend on the passcode.
      const ok = safeEqual(await hmac(env.PASSCODE, tryCode), await hmac(env.PASSCODE, env.PASSCODE));
      if (!ok) {
        await store.noteLoginFailure();
        return err(401, 'wrong_passcode', 'That passcode is wrong.');
      }
      await store.clearLoginFailures();
      const token = await sessionToken(env.PASSCODE);
      return json({ok: true}, 200, {'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`});
    }

    if (path === '/api/logout' && method === 'POST') {
      return json({ok: true}, 200, {'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`});
    }

    // Everything below needs a session.
    if (!configured) return err(503, 'not_configured', 'No passcode has been set for Ektib yet.');
    if (!(await isAuthed(request, env))) return err(401, 'signed_out', 'Sign in to sync your progress.');

    if (path === '/api/progress' && method === 'GET') {
      return json({progress: await store.getProgress()});
    }

    if (path === '/api/progress' && method === 'PUT') {
      const body = await readJson(request);
      if (!isPlainObject(body) || typeof body.updated !== 'number') return err(400, 'bad_request', 'Send the progress object with an `updated` time.');
      const cur = await store.getProgress();
      // A device with older progress must not overwrite newer progress from another device.
      if (cur && typeof cur.updated === 'number' && cur.updated > body.updated) {
        return err(409, 'stale', 'Another device saved newer progress.', {progress: cur});
      }
      await store.putProgress(body);
      return json({ok: true});
    }

    // Recordings of words and story lines, keyed by a hash of their text.
    if (path === '/api/audio' && method === 'GET') {
      return json({index: await store.audioIndex()});
    }
    const am = path.match(AUDIO_KEY);
    if (am) {
      const key = am[1];
      if (method === 'GET') {
        const a = await store.getAudio(key);
        if (!a) return err(404, 'not_found', 'There is no recording for that yet.');
        return new Response(a.data, {headers: {'Content-Type': a.type, 'Cache-Control': 'private, max-age=31536000, immutable'}});
      }
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
    async getProgress() { return (await kv.get('progress')) || null; },
    async putProgress(p) { await kv.put('progress', p); return true; },
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
