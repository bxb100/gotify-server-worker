import { DurableObject } from "cloudflare:workers";

import type { EnvBindings } from "./types";

export class StreamHub extends DurableObject<EnvBindings> {
  private readonly sockets = new Set<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets.add(server);

      const cleanup = () => {
        this.sockets.delete(server);
      };

      server.addEventListener("close", cleanup);
      server.addEventListener("error", cleanup);
      server.addEventListener("message", () => {
        // Ignore inbound traffic. This websocket is server-push only.
      });

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
}
