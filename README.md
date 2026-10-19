# ShadowX AFK Bot — by ShadowX

A split deployment: static dashboard on Netlify, Mineflayer backend on a Node.js host. The dashboard does **not** run the Minecraft bot itself.

## Project structure

- `netlify/` — dashboard files to deploy on Netlify
- `backend/` — Node.js + Express + Socket.IO + Mineflayer service
- `backend/.env.example` — environment variable template

## 1. Deploy the backend first

Use a Node.js hosting provider that supports a persistent Node process and WebSockets (for example, a Node service on Railway, Render, or another provider). Do not deploy the `backend` folder as a static site or serverless-only function.

1. Upload/push this project to a Git repository.
2. Create a new **Node.js web service** and set its root directory to `backend` (if the provider supports a root directory).
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables from `backend/.env.example` in the provider dashboard:
   - `API_TOKEN`: use a long random secret, e.g. generate one locally with `openssl rand -hex 32`. Do not publish it or commit it to Git.
   - `MC_HOST`: Minecraft server hostname (without `https://`)
   - `MC_PORT`: Minecraft port, commonly `25565`
   - `MC_USERNAME`: bot account name
   - `MC_VERSION`: Minecraft version such as `1.21.11`, or `auto`
   - `MC_AUTH`: `offline` for offline-mode servers, `microsoft` for Microsoft authentication
   - `AUTO_RECONNECT`: `true` or `false`
   - `RECONNECT_DELAY_MS`: delay before retry, minimum 3000
   - `ANTI_AFK`: `true` or `false`
   - `PORT` is usually assigned automatically by the host; the code reads it.
6. Deploy and copy the public backend URL, e.g. `https://your-service.example.com`.

`ALLOWED_ORIGINS` is optional. Once your Netlify site URL is known, set it to that exact origin, for example `https://your-site-name.netlify.app`. If left empty, cross-origin requests are allowed but every API and Socket.IO action still requires the API token. For a public deployment, setting an origin allowlist is recommended.

### Microsoft authentication note

Microsoft authentication can require an interactive sign-in the first time. Check your backend host's logs and provider policy. Never enter a Microsoft password into the dashboard. Do not use an account unless you are authorized to use it, and check the Minecraft server's rules.

## 2. Deploy the dashboard to Netlify

1. Create a Git repository containing this project and connect it to Netlify, or use Netlify's manual deploy flow.
2. Build command: leave blank (static site).
3. Publish directory: `netlify`.
4. Deploy the site. Netlify will provide a URL ending in `.netlify.app`.
5. Open that URL. The dashboard's Settings modal should appear.
6. Enter:
   - **Backend URL**: your deployed backend URL, including `https://`, but no `/api` suffix.
   - **API token**: exactly the same value as backend `API_TOKEN`.
   - Minecraft host, port, username, version, auth, and reconnect preferences.
7. Press **Test backend**, then **Save settings**. Use **Connect bot** to start the bot.

After first setup, the backend URL and token are saved in that browser's local storage. If you clear browser data or change browsers/devices, enter them again. The token is not embedded into the public website source.

## 3. Features

- Connection status, session time, health/food/position (when available), player count and reconnect count
- Live console/log stream and export
- Send chat messages to the connected bot
- Configure server, port, username, version, auth mode, reconnect delay and anti-AFK head look
- Automatic reconnect after unexpected disconnects
- API token required for control endpoints and live socket

## 4. Important limits and troubleshooting

- The backend must stay running for the bot to stay online. Netlify hosts only the web dashboard.
- Do not expose the backend without setting a strong `API_TOKEN`.
- If the dashboard says it cannot reach the backend, verify the backend URL, service state, `API_TOKEN`, and `ALLOWED_ORIGINS`.
- If the backend logs say `Unauthorized`, the dashboard token does not match `API_TOKEN`.
- If a provider sleeps/stops free services, the bot disconnects until the backend wakes up.
- Some servers block bots, require online-mode authentication, or disallow automation. Follow their rules.
- `MC_AUTH=microsoft` uses Mineflayer's Microsoft auth flow; the first login may need provider-console interaction.
- The `antiAfk` option only performs occasional head movement; it does not automate combat or bypass server rules.
- The backend keeps recent logs in memory; restarting the backend clears them.
