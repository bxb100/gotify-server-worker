import { DurableObject } from "cloudflare:workers";

import type { EnvBindings } from "./types";

export class StreamHub extends DurableObject<EnvBindings> {
  private readonly sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: EnvBindings) {
    super(state, env);
    state.getWebSockets().forEach((socket) => this.sockets.add(socket));
  }

  cleanup(server: WebSocket) {
    this.sockets.delete(server);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (request.method === "POST" && url.pathname === "/publish") {
      const payload = await request.text();
      for (const socket of [...this.sockets]) {
        try {
          socket.send(payload);
        } catch {
          this.sockets.delete(socket);
          try {
            socket.close(1011, "socket send failed");
          } catch {
            // Socket is already gone.
          }
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }

  async webSocketClose(ws: WebSocket) {
    this.cleanup(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.cleanup(ws);
  }
}
