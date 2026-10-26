import {DurableObject} from 'cloudflare:workers';
import {handleApi, makeStore} from './api.js';

// One Durable Object holds Martin's Ektib progress and recordings (strongly consistent, private to this Worker).
export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = makeStore(ctx.storage);
  }
  getProgress() { return this.s.getProgress(); }
  putProgress(p) { return this.s.putProgress(p); }
  loginFailures() { return this.s.loginFailures(); }
  noteLoginFailure() { return this.s.noteLoginFailure(); }
  clearLoginFailures() { return this.s.clearLoginFailures(); }
  audioIndex() { return this.s.audioIndex(); }
  getAudio(k) { return this.s.getAudio(k); }
  putAudio(k, type, buf, text) { return this.s.putAudio(k, type, buf, text); }
  delAudio(k) { return this.s.delAudio(k); }
}

const mainStore = (env) => env.STORE.get(env.STORE.idFromName('main'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, mainStore(env));
    return env.ASSETS.fetch(request);
  },
};
