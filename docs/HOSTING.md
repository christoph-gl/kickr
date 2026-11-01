# Hosting iamnotadoctor on your own domain

This is the second official way to run iamnotadoctor, next to the default local setup. Read [Choosing a setup](#choosing-a-setup) first; most people should stay local.

## Choosing a setup

| | **Local** (default) | **Hosted** (your own domain) |
| --- | --- | --- |
| Where the app runs | The computer next to the trainer | An always-on machine you control (home server, NAS, mini PC, Raspberry Pi, VPS) |
| Address | `http://localhost:3000` | `https://kickr.example.com` |
| Login | None; only this computer can reach it | One access token (`APP_AUTH_TOKEN`): the browser signs in once, agents send it as a bearer token |
| Agents / bots | Only agents running on the same computer | Any agent, including cloud-hosted bots, over MCP or HTTP |
| Ride history for your bot | Only while that computer is on and the app is running | Any time the server is up |
| Setup effort | `npm install && npm run dev` | Domain, HTTPS reverse proxy, a background service, a secret |
| Riding needs | Nothing else | Internet and the server up: the app page itself is served from your domain |
| Exposure | Nothing reachable from the internet | Public endpoint protected by a single token; anyone with the token can read your rides and control the trainer while a tab is connected |
| Data lives | `.data/` on your computer | `.data/` on the server (back it up) |

**Pick local** if you only ride, or your agent runs on the same computer as the trainer.
**Pick hosted** if your agent runs somewhere else (a cloud bot, another machine) or you want it to query rides while your riding computer is off.

Either way, Bluetooth always runs in the browser tab next to the trainer. In hosted mode that tab simply loads the app from your domain; HTTPS satisfies Web Bluetooth's secure-context rule.

## Requirements

- A machine that stays on, with **Node.js 24+** and git.
- A domain or subdomain pointing at it, served over **HTTPS**.
- Not serverless platforms (Vercel, Netlify, Lambda): the app keeps SQLite and workout files on disk and relays trainer commands in memory, so it needs one long-running Node process.

## Setup

### 1. Install on the server

```bash
git clone https://github.com/christoph-gl/iamnotadoctor.git ~/iamnotadoctor
cd ~/iamnotadoctor
npm install
```

### 2. Create `.env.local` with an access token

```bash
printf 'APP_AUTH_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env.local
```

Setting `APP_AUTH_TOKEN` is what switches the app into hosted mode: every page and API route then requires the token. Add LLM keys (`OPENROUTER_API_KEY` or `LLM_CALLS_API_KEY`, see the README) to the same file if you want the AI features. Never commit `.env.local`.

### 3. Build and run it as a service

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3000   # quick test; Ctrl+C to stop
```

`-H 127.0.0.1` keeps the Node server reachable only through your reverse proxy. For a permanent service on Linux, create `/etc/systemd/system/iamnotadoctor.service`:

```ini
[Unit]
Description=iamnotadoctor
After=network.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/iamnotadoctor
ExecStart=/usr/bin/env npm run start -- -H 127.0.0.1 -p 3000
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now iamnotadoctor
```

### 4. Put HTTPS in front

**Caddy** (gets certificates automatically). `/etc/caddy/Caddyfile`:

```caddy
kickr.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**nginx** works too; pass the original host and scheme so logins and redirects stay on your domain:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Home machine without port forwarding:** a named [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to `http://127.0.0.1:3000` on your own hostname gives you HTTPS on a stable domain. If you already use Cloudflare Access or Tailscale, you can put the app behind them as well; keep `APP_AUTH_TOKEN` set anyway.

### 5. Verify

```bash
TOKEN=$(grep '^APP_AUTH_TOKEN=' .env.local | cut -d= -f2)
curl -s -o /dev/null -w '%{http_code}\n' https://kickr.example.com/api/rider                                  # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" https://kickr.example.com/api/rider # 200
```

### 6. Ride

On the computer or tablet next to the trainer, open `https://kickr.example.com` in **Chrome or Edge**, enter the access token once (the browser stays signed in for 30 days), then click **Connect** for the trainer and heart-rate monitor.

### 7. Connect your agent

MCP server URL: `https://kickr.example.com/api/mcp`, with the header `Authorization: Bearer <APP_AUTH_TOKEN>`.

```json
{
  "mcpServers": {
    "iamnotadoctor": {
      "url": "https://kickr.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <APP_AUTH_TOKEN>" }
    }
  }
}
```

Agents that use the plain HTTP endpoints (`/api/rider`, `/api/sessions`, ...) send the same header.

## Maintenance

- **Update:** `git pull && npm install && npm run build && sudo systemctl restart iamnotadoctor`
- **Back up:** `.data/` (SQLite: rides, profile) and `workouts/` (saved workouts).
- **Rotate the token** (e.g. after sharing it by mistake): replace `APP_AUTH_TOKEN` in `.env.local` and restart. All browsers sign in again and agents need the new token.
- **Go back to local mode:** remove `APP_AUTH_TOKEN`; the app then only answers requests to `localhost`.
