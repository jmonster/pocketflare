export class RealtimeDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(req) {
    return new Response("realtime ok", { status: 200 });
  }
}
