# SWAG — Signal When Arrived, Gremlin!

A family app that lets children tell their parents where they are, and lets the whole family
chat, without giving children a smartphone.

- **Child tablet**, shared by the children at home: three big status buttons ("Je suis à la
  maison", "Je suis parti", "Je suis chez un ami"), the family chat with an on-screen keyboard,
  stickers and drawings.
- **Parent phone**: the children's live statuses, the parent's own availability, the family
  chat, a home-screen widget, and family/device management.

Fall Project, Centrale Digital Lab (Centrale Lyon), Group 5.

## Team

| Member | Role |
| --- | --- |
| Mohamed-Rida | Scrum Master |
| Aude | Development Team |
| Vishwanath | Development Team |
| Abdourahim | Responsible for communication |

---

## Contents

1. [How it works](#1-how-it-works)
2. [Product decisions](#2-product-decisions)
3. [Repository layout](#3-repository-layout)
4. [Install on your computer (once)](#4-install-on-your-computer-once)
5. [Run the project](#5-run-the-project)
6. [Try the apps](#6-try-the-apps)
7. [Use it on a real phone and tablet](#7-use-it-on-a-real-phone-and-tablet)
8. [Running the API on the tablet (Termux)](#8-running-the-api-on-the-tablet-termux)
9. [Notifications and the home-screen widget](#9-notifications-and-the-home-screen-widget)
10. [Tests](#10-tests)
11. [Troubleshooting](#11-troubleshooting)
12. [Status and next steps](#12-status-and-next-steps)

---

## 1. How it works

Both apps talk to one API: REST for everything that is asked for, Socket.IO for everything that
arrives on its own (a status, a message, someone typing, a read receipt).

```
 Parent phone (Expo / React Native)      Child tablet (React + Vite, Capacitor for Android)
          │                                               │
          └──────────── REST /v1  +  Socket.IO /rt ───────┘
                                 │
                       API (NestJS, apps/api)
                 ┌───────────────┼────────────────┐
            PostgreSQL 16     Redis 7      Drawings on disk
          (families, chat…) (real time,    ($HOME/swag-media,
                             rate limits)   served by the API)
```

- Everything is **real time**: a status tapped on the tablet reaches the parent phone at once.
- The tablet keeps taps and messages in an **offline outbox** and sends them when Wi-Fi returns.
- Drawings and images are written to the API's own disk and served back through
  `/v1/media/:id/raw` with a signed link — there is no object storage to run.

The API runs in one of two places.

**In development**, on a developer's PC: PostgreSQL and Redis come from Docker, the API and
both apps run with Node. This is what sections 4 to 7 describe.

**For the family test**, on the child tablet itself, inside Termux: PostgreSQL, Redis and the
API all run on the tablet, and the parent phone reaches it over the network. No PC has to stay
on. This is section 8.

## 2. Product decisions

These come from the design work and from the user tests, and take priority over the original
technical document.

| Topic | Decision |
| --- | --- |
| Chat | **One conversation only**: the family chat. No private threads. |
| Parent availability | **Disponible, Occupé·e, En route** ("Occupée" and "Indisponible" were merged). "En route" counts down in 5-minute steps. |
| Pairing a tablet | The **parent** generates a QR code and a code (Famille → Associer une tablette), the **tablet** scans or types it, then the parent **validates** it. |
| Who is speaking | No "Qui es-tu ?" screen. Checkable **chips** (Léa, Tom, Inès) at the top of the tablet. Several checked = **shared message**; one checked = that child's message. Statuses apply to every checked child. |
| Children writing | A big on-screen keyboard, plus stickers and drawings. |
| GIFs | **Sending removed** after the user test: the button was not wanted. GIFs already received still display, and the backend route is untouched. |
| Read receipts | One tick when a message is sent, two when it has been read. Tapping the ticks says who has read it and who has not. |
| Reading aloud | A speaker button on messages from the other side, for children who do not read yet. Automatic reading was tried and rejected: the button is what the sponsor asked for. |
| Parent identity | A parent chooses the **name** the children see ("Maman", "Papa", or anything else) and a **colour**, in Famille → Modifier. |
| Second parent | Invited with a code from Famille → Inviter. |
| Allowed websites ("Sites") | **Paused.** The code stays, behind `FEATURE_SITES=false`. |

Design references: clickable prototype and screen gallery (P0–P8 parent, K1–K12 tablet), Figma
file `plsacxMv6MPyhWYjoJUL9F`. Visual direction: warm and joyful, violet `#6B4EFF`, sun yellow
`#FFC933`, Fredoka + Nunito, Gremlin mascots. Tokens live in `packages/design-tokens`.

Note that three screens of the prototype no longer exist in the app: K7 (GIF picker), K12
(drawing preview before sending) and P3, all removed after the user tests.

## 3. Repository layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS REST API + Socket.IO gateway, Prisma (PostgreSQL). Full route list: [`apps/api/README.md`](apps/api/README.md) |
| `apps/tablet` | Child tablet: React 19 + Vite 8, packaged for Android with Capacitor 8 |
| `apps/parent` | Parent phone: Expo SDK 57 / React Native 0.86 |
| `packages/protocol` | Shared Zod schemas, request bodies and real-time event types |
| `packages/client` | Typed REST client used by both apps (`createSwagClient`) |
| `packages/design-tokens` | Colours, fonts, labels, Gremlin and sticker SVGs |
| `scripts/termux` | Scripts for running the API on the tablet (section 8) |
| `docker-compose.yml` | Local PostgreSQL and Redis |
| `deploy/` | Production compose file and Caddy config |

## 4. Install on your computer (once)

The commands below are for **Windows**. On macOS/Linux use `cp` instead of `copy`.

| Tool | Why | How |
| --- | --- | --- |
| Node.js 22 | runs everything | `winget install Schniz.fnm`, then `fnm install 22` and `fnm default 22` |
| pnpm | package manager | `corepack enable` then `corepack prepare pnpm@latest --activate` |
| Docker Desktop | database and Redis | [docker.com](https://www.docker.com/products/docker-desktop/), needs WSL 2 and virtualization enabled |
| JDK 21 | Android builds | see [`SETUP.md`](SETUP.md) — the path matters, read it |
| Android SDK | Android builds | Android Studio, or the `sdkmanager` line in [`SETUP.md`](SETUP.md) |
| Expo Go (phone) | open the parent app without building it | Play Store / App Store |

Then, from the repository folder:

```bat
pnpm install
pnpm db:up
copy apps\api\.env.example apps\api\.env
pnpm --filter "./packages/**" build
pnpm --filter @swag/api db:generate
pnpm --filter @swag/api exec prisma migrate deploy
```

| Command | What it does |
| --- | --- |
| `pnpm install` | installs every dependency of every app |
| `pnpm db:up` | starts PostgreSQL (:5432) and Redis (:6379) in Docker |
| `copy … .env` | creates the API settings file (never committed) |
| `build` packages | compiles the shared packages the apps import |
| `db:generate` | generates the Prisma client (**redo it after every change to `schema.prisma`**) |
| `migrate deploy` | creates or updates the database tables |

## 5. Run the project

Use **one terminal per command**:

```bat
pnpm db:up                         :: if Docker was stopped
pnpm --filter @swag/api dev        :: API      -> http://localhost:3100/v1  (check /v1/health)
pnpm --filter @swag/tablet dev     :: tablet   -> http://localhost:5173
pnpm --filter @swag/parent web     :: parent   -> http://localhost:8081 (browser)
```

`http://localhost:3100/v1/health` must answer `"status":"ok"` before anything else works.

Demo data (optional): `pnpm --filter @swag/api seed:dev` creates a family with Léa, Tom and
Inès and an already-paired tablet, and prints a parent login.

Stop everything with `Ctrl+C` in each terminal, and `pnpm db:down` for Docker.

## 6. Try the apps

Open the tablet (http://localhost:5173) and the parent app (http://localhost:8081) side by
side. To get the right sizes, press `F12` then `Ctrl+Shift+M`: about **1280 × 800** for the
tablet and **390 × 844** for the parent.

1. **Parent:** create the family (password of 10+ characters, tick the consent box).
2. **Parent:** Famille → **Ajouter**: Léa, Tom, Inès with their Gremlins.
3. **Parent:** Famille → **Modifier** on your own line: choose "Maman" or "Papa" and a colour.
4. **Parent:** **Associer une tablette** → a QR code and a code like `K7QF-9M2D`.
5. **Tablet:** **Je tape le code** (or **Scanner** with a camera) → "On attend ton parent…".
6. **Parent:** the "Valider la tablette" sheet opens → **Associer**.
7. **Tablet:** check only Tom → **Je suis chez un ami**. The parent home updates live.
8. **Parent:** tap **En route** and pick 20 min. The tablet counts down in 5-minute steps.
9. **Tablet:** check Léa and Tom → **Discuter** → keyboard icon → write → **Envoyer**. Then a
   sticker, then a drawing (**Dessiner**).
10. **Parent:** the chat shows "Léa et Tom · message commun", the sticker and the drawing. Reply,
    then tap the ticks under your own message to see who has read it.
11. **Offline test:** stop the API, tap a status on the tablet ("Pas encore envoyé"), restart the
    API: it is sent automatically.

To pair the tablet again: on the tablet page, `F12` → Application → Local Storage → delete
`swag.device`, then reload.

## 7. Use it on a real phone and tablet

In development the tablet's Vite server is also a **gateway**: it forwards `/v1` and
`/socket.io` to the API, so one address gives access to everything. Do **not** set
`VITE_API_URL` in `apps/tablet/.env` for this.

### Option A — same Wi-Fi

1. Put the PC, phone and tablet on the **same Wi-Fi** (school Wi-Fi often blocks this; a home
   box or a phone hotspot works).
2. Find the PC's IP: `ipconfig` → "IPv4 Address", e.g. `192.168.1.20`.
3. When Windows asks, allow Node.js on **private networks**.
4. Start the API and the tablet (section 5).
5. **Tablet:** open `http://192.168.1.20:5173` in Chrome. The camera needs `https`, so use
   **Je tape le code**.
6. **Phone:** put `EXPO_PUBLIC_API_URL=http://192.168.1.20:5173` in `apps\parent\.env`, run
   `pnpm --filter @swag/parent start` and scan the QR code with **Expo Go**.

### Option B — one public ngrok link

1. Once: free account on [ngrok.com](https://ngrok.com), then `ngrok config add-authtoken <token>`.
2. Start Docker, the API and the tablet (section 5).
3. `ngrok http 5173` and copy the `https://….ngrok-free.dev` link.
4. **Tablet:** open the link in Chrome, click **Visit Site** once.
5. **Phone:** put that link in `apps\parent\.env` as `EXPO_PUBLIC_API_URL`, then
   `pnpm --filter @swag/parent tunnel`, and scan the QR code with **Expo Go**.

The free link changes every time ngrok restarts. Your PC must stay on.

### Option C — real Android apps

Both apps install as real APKs, which is how the family test was run. Expo Go is not involved.

```bat
:: tablet
pnpm --filter @swag/tablet build
pnpm --filter @swag/tablet cap:sync
cd apps\tablet\android && .\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk

:: parent
cd apps\parent\android && .\gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

The tablet app is allowed to talk to a plain `http` API (`androidScheme: 'http'` and
`cleartext: true` in `capacitor.config.ts`), which is what makes the Termux setup below
possible. That is a development arrangement: put the API behind `https` before any real use.

The parent app does not hardcode an address: open **Serveur** on the sign-in screen and type
the API's address. It is saved on the phone, and the app has to be restarted to use it.

## 8. Running the API on the tablet (Termux)

For the family test the whole backend runs on the child tablet, so nothing depends on a PC
being switched on. PostgreSQL, Redis and the API all live inside **Termux**.

What is on the tablet:

| Path | What |
| --- | --- |
| `~/swag` | the repository's compiled output (not a git clone) |
| `~/swag/apps/api/dist` | the compiled API, started with `node dist/main.js` |
| `~/swag/apps/api/.env` | its settings, including `FCM_SERVICE_ACCOUNT_PATH` |
| `~/swag-media` | the drawings, written by the API |
| `~/start-swag.sh` | a copy of `scripts/termux/start-swag.sh` |
| `~/api.log` | the API's output |

`scripts/termux/start-swag.sh` starts only what is stopped — it clears the PostgreSQL lock file
left by a brutal Termux shutdown, starts Redis if it is not answering, launches the API with
`setsid nohup` so it survives the end of the SSH session, then checks `/v1/health`.

`scripts/termux/fix-argon2.sh` is needed once per install: argon2's native build crashes on some
Android CPUs, so the script forces the WebAssembly build and works around its filesystem
restrictions. It is idempotent.

### Driving the tablet from a PC

Termux is reachable over SSH through the USB cable, which is far more comfortable than typing
on the tablet. In Termux, once: `pkg install -y openssh`, then `passwd`. Then each time:

```
sshd
```

and on the PC:

```powershell
adb forward tcp:8022 tcp:8022
ssh -p 8022 <termux-user>@127.0.0.1
```

`<termux-user>` is what `whoami` prints in Termux (`u0_aNNN`).

### Shipping a new API build

The tablet has neither git nor pnpm, so the compiled output is copied over:

```powershell
:: on the PC
pnpm build
tar -czf swag-api-update.tgz apps/api/dist packages/protocol/dist packages/client/dist packages/design-tokens/dist
adb push swag-api-update.tgz /sdcard/Download/
```

```
# in the SSH session on the tablet
cd ~/swag && tar -xzf /sdcard/Download/swag-api-update.tgz
pkill -f "node dist/main.js"; sleep 2; ~/start-swag.sh
```

Database migrations are **not** applied by this. The tablet's database was created with
`prisma db push`, so it has no `_prisma_migrations` table: apply schema changes by hand with
`psql`, or recreate the database.

## 9. Notifications and the home-screen widget

The parent app receives data-only Firebase (FCM) pushes carrying IDs only, never names or
message text. A background task then fetches the details over the authenticated API, refreshes
the home-screen widget and shows the notification. This works with the app closed, and needs a
real Android build — not Expo Go.

1. In the [Firebase console](https://console.firebase.google.com), create a project and add an
   Android app with the package `fr.centraledigitallab.swag.parent`.
2. Download its `google-services.json` into `apps/parent/`, then rebuild. Without that file the
   app still builds but gets no push token.
3. Project settings → Service accounts → generate a private key. Save it **outside the repo**
   and point `FCM_SERVICE_ACCOUNT_PATH` at it in the API's `.env`. Without it the API only
   records pushes in memory and sends nothing.
4. On the phone, sign in and allow notifications. Add the widget: long-press the home screen →
   Widgets → "SWAG – Enfants".

On Xiaomi, Redmi and Poco phones, also turn on **Autostart** for the app and set its battery
saver to **No restrictions**, or MIUI kills the background task and no notification arrives.

## 10. Tests

| What | Command |
| --- | --- |
| API end-to-end (separate `swag_test` database, Docker must be up) | `pnpm --filter @swag/api test` |
| Shared schemas | `pnpm --filter @swag/protocol test` |
| API client | `pnpm --filter @swag/client test` |
| Types, all apps | `pnpm typecheck` |
| Lint | `pnpm lint` |

Manual API calls: the request list in [`apps/api/README.md`](apps/api/README.md) works well with
the REST Client extension. Browse the database with `pnpm --filter @swag/api db:studio`.

## 11. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Docker Desktop is unable to start` | Open Docker Desktop and wait for "Engine running". Else `wsl --update`, `wsl --shutdown`, restart Docker; check Task Manager → Performance → CPU → Virtualization: Enabled. |
| `Cannot find module '../generated/prisma/client'` | `pnpm --filter @swag/api db:generate`, then restart the API. |
| `Cannot resolve environment variable: DATABASE_URL` | `copy apps\api\.env.example apps\api\.env` |
| `ERROR: JAVA_HOME is set to an invalid directory` | `.vscode/settings.json` points every project terminal at `%LOCALAPPDATA%\Programs\jdk-21`. Either install the JDK there, or link it once: `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\Programs\jdk-21" -Target "<your JDK>"`. |
| `INSTALL_FAILED_USER_RESTRICTED` when installing an APK | Xiaomi blocks installing over USB. Either turn on "Install via USB" in developer options, or push and install from the device's own storage: `adb push <apk> /data/local/tmp/x.apk` then `adb shell pm install -r /data/local/tmp/x.apk`. |
| `pm install` says `Couldn't visit directory` for `/sdcard/...` | The system server cannot read `/sdcard`. Push to `/data/local/tmp/` instead. |
| Parent app: "Pas de connexion au serveur SWAG" | Wrong address in **Serveur** on the sign-in screen, or in `apps\parent\.env`. Check `/v1/health` from the phone's browser. |
| CORS error in a browser | Add the page's address to `CORS_ORIGINS` in the API's `.env` and restart it. |
| Tablet stuck or blank | Is the API running? Open `/v1/health`. |
| "Ce code a expiré" | Codes last 10 minutes. Parent: **Nouveau code**. |
| GIFs "indisponibles" | Put a Giphy API key in `GIPHY_API_KEY`. Sending GIFs was removed from the apps, so this only affects old messages. |
| The speaker button says nothing on the tablet | Android needs a speech engine with French installed: Settings → Text-to-speech → install the voice data. |
| Port already in use | Close the old terminal, or change `PORT` in the API's `.env`. |

## 12. Status and next steps

Done:

- **API:** accounts, invites for a second parent, pairing, statuses, presence, family chat with
  "who is speaking", read receipts per member, stickers, drawings, GDPR export and erasure,
  security hardening, FCM pushes.
- **Tablet:** pairing, statuses, chat with keyboard and stickers, drawing, offline outbox,
  sound on an incoming message, read receipts.
- **Parent:** sign-up and login, home, family chat, drawing (full tool set) and drawing viewer,
  family and devices, QR pairing and validation, home-screen widget, own name and colour.
- **Deployment:** the whole backend runs on the tablet in Termux (section 8).

To do:

- The S3 settings are **dead but still required**: `S3_ENDPOINT` and friends are validated at
  startup and read by nothing — media goes to disk. Remove them from `apps/api/src/config/env.ts`,
  from `.env.example`, from `docker-compose.yml` and from the `/s3` proxy in
  `apps/tablet/vite.config.ts`.
- Artwork for the "feelings", "home" and "animals" sticker packs (only the SWAG pack is drawn).
- Put the API behind `https` on a real server, and drop the cleartext allowance in
  `capacitor.config.ts`.
- On the tablet, the chat leaves a gap between the text box and the keyboard. Three attempts
  failed; `chrome://inspect` on the debug build would settle it.
- "Sites", when the team picks it up again (`FEATURE_SITES=true`).
