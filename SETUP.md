# SWAG developer setup (Windows)

Run these once per machine. None of them need admin rights.

```bat
:: 1. Node 22 via fnm (leaves any existing system Node untouched)
winget install --id Schniz.fnm -e --scope user
fnm install 22
fnm default 22

:: 2. pnpm (open a new terminal first, so fnm is on PATH)
corepack enable
corepack prepare pnpm@latest --activate

:: 3. JDK 21 (Capacitor 8 and the Expo build need it): take the Eclipse Temurin 21 x64 .zip
::    from https://adoptium.net and extract it as  %LOCALAPPDATA%\Programs\jdk-21

:: 4. Android SDK packages (Android Studio > SDK Manager, or):
set JAVA_HOME=%LOCALAPPDATA%\Programs\jdk-21
"%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

**The JDK path matters.** `.vscode/settings.json` points every project terminal at
`%LOCALAPPDATA%\Programs\jdk-21`, so a JDK installed anywhere else gives
`ERROR: JAVA_HOME is set to an invalid directory` on every Gradle build. If yours is already
somewhere else — the Adoptium installer puts it under `C:\Program Files` — link it once instead
of moving it, in PowerShell, no admin rights needed:

```powershell
New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\Programs\jdk-21" -Target "C:\Program Files\Eclipse Adoptium\jdk-21.x.y-hotspot"
```

Then open this folder in VS Code and accept the recommended extensions. In a project terminal
`node -v` should print v22 and `java -version` should print 21.

Docker Desktop is required for the local PostgreSQL and Redis containers.

## Run it locally

```bat
pnpm install
pnpm db:up                                    :: PostgreSQL :5432, Redis :6379
copy apps\api\.env.example apps\api\.env
pnpm --filter "./packages/**" build           :: shared packages (protocol, client, design tokens)
pnpm --filter @swag/api db:generate           :: Prisma client (again after every schema.prisma change)
pnpm --filter @swag/api db:migrate            :: apply Prisma migrations
pnpm --filter @swag/api dev                   :: API on http://localhost:3100/v1 (health: /v1/health)
pnpm --filter @swag/tablet dev                :: tablet UI in the browser (Vite)
pnpm --filter @swag/parent start              :: parent app via Expo
```

- Backend tests: `pnpm --filter @swag/api test` (Docker must be up; they use a separate
  `swag_test` database). Demo family with working logins: `pnpm --filter @swag/api seed:dev`.
  Full API reference: [apps/api/README.md](apps/api/README.md).
- Tablet as an Android app: `pnpm --filter @swag/tablet build && pnpm --filter @swag/tablet cap:sync`,
  then `cap:open` (Android Studio) or `apps\tablet\android\gradlew assembleDebug`.
- Parent as an Android app: `apps\parent\android\gradlew assembleRelease`. The parent app does
  not hardcode an API address — type it in **Serveur** on the sign-in screen.
- Port 3100 is used because 3000 is often taken; change `PORT` in `apps/api/.env` if needed.
- `apps/tablet/.env.example` is entirely commented out on purpose: leave `VITE_API_URL` unset
  for `pnpm dev`, and set it only when building the Android app against a fixed address.

## Settings worth knowing

`apps/api/.env.example` is the reference. Three entries deserve a note:

| Variable | Note |
| --- | --- |
| `CORS_ORIGINS` | Browser origins allowed for both HTTP and sockets. Native apps send no Origin and are unaffected. Add the Vite and Expo-web addresses when you develop in a browser. |
| `FCM_SERVICE_ACCOUNT_PATH` | Firebase service-account JSON, kept outside the repo. Unset = the API records pushes in memory and sends nothing. |
| `S3_*` | **Dead but still required.** The API writes media to disk (`MEDIA_DIR`, or `$HOME/swag-media`) and reads none of these; the schema still validates them, so they have to be present. Removing them is on the to-do list. |

## Workspace layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS 12 REST API + Socket.IO gateway, Prisma 7 (PostgreSQL) |
| `apps/tablet` | Child tablet: React 19 + Vite 8, packaged with Capacitor 8 for Android |
| `apps/parent` | Parent phone: Expo SDK 57 / React Native 0.86 |
| `packages/protocol` | Shared Zod schemas and Socket.IO event types |
| `packages/client` | Typed REST client used by both apps (`createSwagClient`) |
| `packages/design-tokens` | Design tokens (colours, Fredoka/Nunito, labels) and SVG art |
| `scripts/termux` | Running the API on the tablet — see section 8 of the README |

## Share it with one ngrok link

In development the tablet's Vite server is also a gateway: `/v1` and `/socket.io` are proxied
to the API, so one address gives access to everything.

1. `winget install ngrok.ngrok`, free account on ngrok.com, then `ngrok config add-authtoken <token>`.
2. Start Docker (`pnpm db:up`), the API and the tablet.
3. `ngrok http 5173`, open the `https://….ngrok-free.app` link on the tablet ("Visit Site").
4. Parent app: put the same link in `apps/parent/.env` as `EXPO_PUBLIC_API_URL`, then
   `pnpm --filter @swag/parent tunnel` and scan the QR code with Expo Go.

Do not set `VITE_API_URL` in `apps/tablet/.env` for this: without it the tablet uses the page's
own address. The free link changes every time ngrok restarts.

## Notifications and the home-screen widget

See section 9 of the [README](README.md): Firebase project, `google-services.json` in
`apps/parent/`, service-account key pointed at by `FCM_SERVICE_ACCOUNT_PATH`, and — on Xiaomi
phones — Autostart on and battery saver off for the app.

## Running the API on the tablet

A brand-new tablet, set up by a non-developer: [`GUIDE-TABLETTE.md`](GUIDE-TABLETTE.md),
in French, one command at a time.

See section 8 of the [README](README.md). In short: PostgreSQL, Redis and the API run inside
Termux on the child tablet, `scripts/termux/fix-argon2.sh` is applied once per install,
`scripts/termux/start-swag.sh` brings everything up, and new API builds are shipped as a
tarball of the compiled output over `adb`.
