import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {handleApi, makeStore, summarize} from './api.js';

// One Durable Object holds Ektib progress (Martin's and his friends'), accounts and recordings (strongly consistent, private to this Worker).
export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = makeStore(ctx.storage);
  }
  getProgress(uid) { return this.s.getProgress(uid); }
  putProgress(p, uid) { return this.s.putProgress(p, uid); }
  delProgress(uid) { return this.s.delProgress(uid); }
  getUsers() { return this.s.getUsers(); }
  putUsers(u) { return this.s.putUsers(u); }
  loginFailures() { return this.s.loginFailures(); }
  noteLoginFailure() { return this.s.noteLoginFailure(); }
  clearLoginFailures() { return this.s.clearLoginFailures(); }
  audioIndex() { return this.s.audioIndex(); }
  ttsIndex() { return this.s.ttsIndex(); }
  getTts(k) { return this.s.getTts(k); }
  putTts(k, buf, p, t) { return this.s.putTts(k, buf, p, t); }
  getAudio(k) { return this.s.getAudio(k); }
  putAudio(k, type, buf, text) { return this.s.putAudio(k, type, buf, text); }
  delAudio(k) { return this.s.delAudio(k); }
}

const mainStore = (env) => env.STORE.get(env.STORE.idFromName('main'));

// Read-only progress summary for the Life dashboard. A named entrypoint is only reachable
// through a Cloudflare service binding from Martin's own Workers, never from the internet.
export class Summary extends WorkerEntrypoint {
  async summary() { return summarize(await mainStore(this.env).getProgress()); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, mainStore(env));
    return env.ASSETS.fetch(request);
  },
};
