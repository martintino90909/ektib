import {DurableObject} from 'cloudflare:workers';
import {handleApi, makeStore} from './api.js';

// One Durable Object holds Martin's Ektib progress (strongly consistent, private to this Worker).
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
}

const mainStore = (env) => env.STORE.get(env.STORE.idFromName('main'));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, mainStore(env));
    return env.ASSETS.fetch(request);
  },
};
