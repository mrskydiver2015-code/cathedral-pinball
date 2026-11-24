import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import * as adminApi from './api/admin.js';
import * as friendsApi from './api/friends.js';
import * as leaderboardApi from './api/leaderboard.js';
import * as profileApi from './api/profile.js';

type RouteModule = {
  GET?: (req: Request) => Promise<Response>;
  POST?: (req: Request) => Promise<Response>;
  DELETE?: (req: Request) => Promise<Response>;
};

const API_ROUTES: Readonly<Record<string, RouteModule>> = {
  '/api/profile': profileApi,
  '/api/leaderboard': leaderboardApi,
  '/api/friends': friendsApi,
  '/api/admin': adminApi,
};

function readNodeBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function attachApiMiddleware(middlewares: {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}): void {
  middlewares.use((req, res, next) => {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0];
    const mod = API_ROUTES[pathname];
    if (!mod) {
      next();
      return;
    }

    void (async () => {
      try {
        const method = (req.method ?? 'GET').toUpperCase() as keyof RouteModule;
        const handler = mod[method];
        if (!handler) {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: `Method ${method} not allowed` }));
          return;
        }

        const host = req.headers.host ?? 'localhost:5173';
        const fullUrl = `http://${host}${rawUrl}`;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) {
            headers.set(k, v.join(', '));
          } else if (typeof v === 'string') {
            headers.set(k, v);
          }
        }

        const hasBody = method !== 'GET' && method !== 'DELETE';
        const bodyBuf = hasBody ? await readNodeBody(req) : undefined;
        const webReq = new Request(fullUrl, {
          method,
          headers,
          body: bodyBuf && bodyBuf.length > 0 ? new Uint8Array(bodyBuf) : undefined,
        });

        const webRes = await handler(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const respBuf = Buffer.from(await webRes.arrayBuffer());
        res.end(respBuf);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
          }),
        );
      }
    })();
  });
}

function cathedralLocalApiPlugin(): Plugin {
  return {
    name: 'cathedral-local-api',
    configureServer(server) {
      attachApiMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachApiMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [cathedralLocalApiPlugin()],
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
