<p align="center">
    <a href="https://github.com/gotify/logo">
        <img height="275px" src="https://raw.githubusercontent.com/gotify/logo/master/gotify-logo.png" />
    </a>
</p>

<h1 align="center">gotify/server cloudflare worker</h1>

## Introduction

> [!WARNING]  
> Vibe coding with Codex, Gemini, and Copilot. This repository has not been fully reviewed.

The source code and UI are derived from https://github.com/gotify/server. All credit goes to them.

## Drawback

- API change may not affect immediately

## How to use

1. `npx wrangler d1 create gotify`, remember replace with your own `database_id` in `wrangler.jsonc`
2. `npx wrangler d1 migrations apply gotify --remote`
3. `npx wrangler r2 bucket create gotify-worker`
4. Configure plugins in `src/worker/plugins.ts`
5. `npm run cf-typegen`
6. `npm run build && npm run deploy`

## Plugins

- Plugin logic now lives under `plugins/`
- Each plugin is a standalone workspace package that extends `GotifyPlugin`
- The worker instantiates plugins directly through `src/worker/plugin-registry.ts`
- Add or remove plugins by editing `src/worker/plugin-registry.ts`
- After changing plugin bindings or worker exports, rerun `npm run cf-typegen`

## Client

<a href="https://www.raycast.com/Lemon/gotify" title="Install gotify Raycast Extension"><img src="https://www.raycast.com/Lemon/gotify/install_button@2x.png?v=1.1" height="64" style="height: 64px;" alt="" /></a>
