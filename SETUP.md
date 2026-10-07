# SWAG developer setup (Windows)

Run these once per machine from a terminal. None of them need admin rights.

```bat
:: 1. Node 22 via fnm (keeps any existing system Node untouched)
winget install --id Schniz.fnm -e --scope user
fnm install 22
fnm default 22

:: 2. pnpm (open a new terminal first so fnm is on PATH)
corepack enable
corepack prepare pnpm@latest --activate

:: 3. JDK 21 (Capacitor 8 needs it): download the Eclipse Temurin 21 x64 .zip from https://adoptium.net,
::    extract it, and rename the folder to %LOCALAPPDATA%\Programs\jdk-21

:: 4. Android SDK packages (Android Studio > SDK Manager, or):
set JAVA_HOME=%LOCALAPPDATA%\Programs\jdk-21
"%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

Then open this folder in VS Code and accept the recommended extensions.
The project terminal (`.vscode/settings.json`) already puts Node 22, JDK 21 and `adb` on PATH,
so `node -v` should print v22 and `java -version` should print 21 there.

Docker Desktop is required for the local Postgres, Redis and S3 (RustFS) containers.

## Run it locally

```bat
pnpm install
pnpm db:up                                    :: Postgres :5432, Redis :6379, S3 (RustFS) :9000, console :9001
copy apps\api\.env.example apps\api\.env
copy apps\tablet\.env.example apps\tablet\.env
pnpm --filter "./packages/**" build          :: shared packages (protocol, client, design tokens)
pnpm --filter @swag/api db:generate           :: Prisma client (again after every schema.prisma change)
pnpm --filter @swag/api db:migrate            :: apply Prisma migrations
pnpm --filter @swag/api dev                   :: API on http://localhost:3100/v1 (health: /v1/health)
pnpm --filter @swag/tablet dev                :: tablet UI in the browser (Vite)
pnpm --filter @swag/parent start              :: parent app via Expo
```

- Backend tests: `pnpm --filter @swag/api test`. Demo family with working logins (API running): `pnpm --filter @swag/api seed:dev`. Full API reference: [apps/api/README.md](apps/api/README.md).
- Tablet on Android: `pnpm --filter @swag/tablet build && pnpm --filter @swag/tablet cap:sync`, then `cap:open` (Android Studio) or `apps\tablet\android\gradlew assembleDebug`.
- Port 3100 is used because 3000 is often taken; change `PORT` in `apps/api/.env` if needed.
- The apps must sign in for real (parent login, tablet pairing); use `seed:dev` to get credentials. The old `dev:` socket tokens still connect locally (`ALLOW_DEV_TOKENS=true`) but cannot write data.

## Workspace layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS 12 REST API + Socket.IO gateway, Prisma 7 (PostgreSQL) |
| `apps/tablet` | Child tablet: React 19 + Vite 8, packaged with Capacitor 8 for Android |
| `apps/parent` | Parent phone: Expo SDK 57 / React Native 0.86 |
| `packages/protocol` | Shared Zod schemas and Socket.IO event types |
| `packages/client` | Typed REST client used by both apps (`createSwagClient`) |
| `packages/design-tokens` | SWAG design tokens (colours, Fredoka/Nunito, status and availability labels) and SVG art (Gremlins, stickers) |

## Share it with one ngrok link (phone, tablet, teammates)

In development the tablet's Vite server is also a gateway: `/v1` (API), `/socket.io` (real time) and `/s3` (drawings, GIFs) are proxied to the local services, so one address gives access to everything.

1. Install ngrok (`winget install ngrok.ngrok`), create a free account on ngrok.com and run `ngrok config add-authtoken <token>` once.
2. Start Docker (`pnpm db:up`), the API (`pnpm --filter @swag/api dev`) and the tablet (`pnpm --filter @swag/tablet dev`).
3. `ngrok http 5173` and open the `https://….ngrok-free.app` link on the tablet (click "Visit Site" once).
4. Parent app on a phone: put the same link in `apps/parent/.env` as `EXPO_PUBLIC_API_URL=https://….ngrok-free.app`, then `pnpm --filter @swag/parent start -- --tunnel` and scan the QR code with Expo Go.

Do not set `VITE_API_URL` in `apps/tablet/.env` for this: without it, the tablet uses the page's own address. The link changes every time ngrok restarts (a free static domain avoids that: `ngrok http --url=<your-domain> 5173`).
