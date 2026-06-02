// RealtimeDO — Durable Object that owns SSE connections for PocketBase realtime.
//
// A single instance (idFromName("hub")) manages all client connections.
// PocketBase's Go runtime handles auth, subscription matching, and message
// formatting; the DO only handles transport: holding connections open and
// delivering formatted SSE frames to the right client.

export class RealtimeDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Map of clientId -> { writer, type: "sse"|"ws" }
    this.connections = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/__send":
        return this.handleSend(request);
      case "/__subscribe":
        return this.handleSubscribe(request);
      case "/__unsubscribe":
        return this.handleUnsubscribe(request);
      case "/__subscriptions":
        return this.handleListSubscriptions(request);
      case "/__poll":
        return this.handlePoll(request);
      default:
        return this.handleConnection(request);
    }
  }

  // ── Client connection (SSE) ──────────────────────────────────────────

  async handleConnection(request) {
    const clientId = crypto.randomUUID();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    this.connections.set(clientId, { writer, type: "sse" });
    console.log({ family: "pocketflare-realtime", phase: "connect", clientId });

    request.signal.addEventListener("abort", () => {
      this.connections.delete(clientId);
      this.ctx.storage.delete(`sub:${clientId}`).catch(() => {});
      writer.close().catch(() => {});
    });

    // Send PB_CONNECT exactly as PocketBase does
    const connectMsg = `id:${clientId}\nevent:PB_CONNECT\ndata:${JSON.stringify({ clientId })}\n\n`;
    try {
      await writer.write(encoder.encode(connectMsg));
    } catch {
      this.connections.delete(clientId);
      return new Response(null, { status: 500 });
    }

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Internal: message delivery from Go ───────────────────────────────

  async handleSend(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const { clientId, event, data } = body;
    if (!clientId || !event || data === undefined) {
      return new Response("missing fields", { status: 400 });
    }

    const conn = this.connections.get(clientId);
    if (conn) {
      const encoder = new TextEncoder();
      const msg = `id:${clientId}\nevent:${event}\ndata:${data}\n\n`;
      try {
        await conn.writer.write(encoder.encode(msg));
        return new Response("ok", { status: 200 });
      } catch {
        this.connections.delete(clientId);
        this.ctx.storage.delete(`sub:${clientId}`).catch(() => {});
        return new Response("write failed", { status: 500 });
      }
    }

    // Client not in local connections — check for subscription metadata
    // placed by Go via /__subscribe. If present, queue the message for
    // the Worker-held SSE connection to retrieve via /__poll.
    const sub = await this.ctx.storage.get(`sub:${clientId}`);
    if (sub) {
      const msgKey = `msg:${clientId}`;
      let messages = (await this.ctx.storage.get(msgKey)) || [];
      messages.push({ event, data });
      if (messages.length > 100) messages = messages.slice(-100);
      await this.ctx.storage.put(msgKey, messages);
      return new Response("queued", { status: 200 });
    }

    return new Response("client not found", { status: 404 });
  }

  // ── Internal: subscription metadata storage ──────────────────────────

  async handleSubscribe(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const { clientId, subscriptions, authRecordId, authCollectionName } = body;
    if (!clientId) {
      return new Response("missing clientId", { status: 400 });
    }

    await this.ctx.storage.put(`sub:${clientId}`, {
      subscriptions: subscriptions || [],
      authRecordId: authRecordId || "",
      authCollectionName: authCollectionName || "",
      updatedAt: Date.now(),
    });

    return new Response("ok", { status: 200 });
  }

  // ── Internal: list all subscriptions (for cross-isolate sync) ─────────

  async handleListSubscriptions(_request) {
    const result = [];
    const prefix = "sub:";
    const map = await this.ctx.storage.list({ prefix });
    for (const [key, value] of map) {
      result.push({
        clientId: key.slice(prefix.length),
        ...value,
      });
    }
    return Response.json(result);
  }

  // ── Internal: message polling (for Worker-held SSE connections) ────────

  async handlePoll(request) {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    if (!clientId) {
      return new Response("missing clientId", { status: 400 });
    }

    const msgKey = `msg:${clientId}`;
    const messages = (await this.ctx.storage.get(msgKey)) || [];
    if (messages.length > 0) {
      await this.ctx.storage.delete(msgKey);
    }
    return Response.json(messages);
  }

  async handleUnsubscribe(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const { clientId } = body;
    if (!clientId) {
      return new Response("missing clientId", { status: 400 });
    }

    await this.ctx.storage.delete(`sub:${clientId}`);
    return new Response("ok", { status: 200 });
  }
}
