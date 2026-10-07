# SWAG — Signal When Arrived, Gremlin!

A family app that lets children tell their parents where they are, and lets the whole family chat, without giving children a smartphone.

- **Child tablet** (shared by the children at home): big status buttons ("Je suis à la maison", "Je suis parti", "Je suis chez un ami"), the family chat with an on-screen keyboard, stickers, GIFs and drawings.
- **Parent phone**: the children's live statuses, the parent's availability, the family chat, and family/device management.

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
8. [Tests](#8-tests)
9. [Troubleshooting](#9-troubleshooting)
10. [Status and next steps](#10-status-and-next-steps)

---

## 1. How it works

```
 Parent phone (Expo / React Native)          Child tablet (React + Vite, Capacitor for Android)
          │                                                   │
          └──────────── REST /v1  +  Socket.IO /rt ───────────┘
                                   │
                         API (NestJS, apps/api)
                 ┌─────────────────┼──────────────────┐
           PostgreSQL 16        Redis 7        S3 storage (RustFS)
         (families, chat…)  (real time, limits)   (drawings, GIFs)
```

- Everything is **real time**: a status tapped on the tablet appears on the parent phone instantly (Socket.IO).
- The tablet keeps taps and messages in an **offline outbox** and sends them when Wi-Fi comes back.
- Locally, PostgreSQL, Redis and the S3 storage run in **Docker**; the API and both apps run with Node.

## 2. Product decisions

These come from the design work and take priority over the original technical document.

| Topic | Decision |
| --- | --- |
| Chat | **One conversation only**: the family chat. No private threads. |
| Parent availability | **Disponible, Occupé·e, En route** ("Occupée" and "Indisponible" were merged). |
| Pairing a tablet | The **parent** generates a QR code and a code (Famille > Associer une tablette), the **tablet** scans or types it, then the parent **validates** the tablet. |
| Who is speaking | No "Qui es-tu ?" screen. Checkable **chips** (Léa, Tom, Inès) at the top of the tablet. Several checked = **shared message**; one checked = that child's message. Statuses apply to every checked child. |
| Children writing | Children can type messages on a big on-screen AZERTY keyboard, plus stickers, GIFs and drawings. |
| Allowed websites ("Sites") | **Paused for now.** The code stays, behind `FEATURE_SITES=false`. |

Design references: clickable prototype and screen gallery (P0–P8 parent, K1–K12 tablet), Figma file `plsacxMv6MPyhWYjoJUL9F`. Visual direction: warm and joyful, violet `#6B4EFF`, sun yellow `#FFC933`, Fredoka + Nunito, Gremlin mascots. Tokens live in `packages/design-tokens`.

## 3. Repository layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS REST API + Socket.IO gateway, Prisma (PostgreSQL). Full route list: [`apps/api/README.md`](apps/api/README.md) |
| `apps/tablet` | Child tablet: React 19 + Vite, packaged for Android with Capacitor |
| `apps/parent` | Parent phone: Expo / React Native (also runs in a browser) |
| `packages/protocol` | Shared Zod schemas, request bodies and real-time event types |
| `packages/client` | Typed REST client used by both apps (`createSwagClient`) |
| `packages/design-tokens` | Colours, fonts, labels, Gremlin and sticker SVGs |
| `docker-compose.yml` | Local PostgreSQL, Redis and S3 storage |
| `deploy/` | Production compose file and Caddy config (Scaleway) |

## 4. Install on your computer (once)

The commands below are for **Windows** (cmd or the VS Code terminal). On macOS/Linux use `cp` instead of `copy`.

### 4.1 Tools

| Tool | Why | How |
| --- | --- | --- |
| Node.js 22 | runs everything | `winget install Schniz.fnm`, then `fnm install 22` and `fnm default 22` |
| pnpm | package manager | `corepack enable` then `corepack prepare pnpm@latest --activate` |
| Docker Desktop | database, Redis, storage | [docker.com](https://www.docker.com/products/docker-desktop/), needs WSL 2 and virtualization enabled |
| Git | code | already installed if you cloned the repo |
| Expo Go (phone) | open the parent app on a phone | Play Store / App Store |
| ngrok (optional) | share the apps with one public link | `winget install ngrok.ngrok` |

More detail (JDK and Android SDK for the Android tablet build): [`SETUP.md`](SETUP.md).

### 4.2 Project setup

From the repository folder:

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
| `pnpm db:up` | starts PostgreSQL (:5432), Redis (:6379) and the S3 storage (:9000, console :9001) in Docker |
| `copy … .env` | creates the API settings file (never committed) |
| `build` packages | compiles the shared packages the apps import |
| `db:generate` | generates the Prisma client (**redo it after every change to `schema.prisma`**) |
| `migrate deploy` | creates or updates the database tables |

Then open `apps\api\.env` and make sure this line is there (add it if not):

```
CORS_ORIGINS=http://localhost:5173,http://localhost:8081
```

## 5. Run the project

Use **one terminal per command**:

```bat
pnpm db:up                         :: if Docker was stopped
pnpm --filter @swag/api dev        :: API      → http://localhost:3100/v1  (check /v1/health)
pnpm --filter @swag/tablet dev     :: tablet   → http://localhost:5173
pnpm --filter @swag/parent web     :: parent   → http://localhost:8081 (browser)
```

`http://localhost:3100/v1/health` must answer `"status":"ok"` before anything else works.

Demo data (optional): `pnpm --filter @swag/api seed:dev` creates a family with Léa, Tom and Inès and an already-paired tablet, and prints a parent login.

Stop everything with `Ctrl+C` in each terminal and `pnpm db:down` for Docker.

## 6. Try the apps

Open the tablet (http://localhost:5173) and the parent app (http://localhost:8081) side by side. To get the right sizes, press `F12` then `Ctrl+Shift+M`: about **1280 × 800** for the tablet and **390 × 844** for the parent.

Test scenario:

1. **Parent:** create the family (password of 10+ characters, tick the consent box).
2. **Parent:** Famille > **Ajouter**: Léa, Tom, Inès with their Gremlins.
3. **Parent:** **Associer une tablette** → a QR code and a code like `K7QF-9M2D`.
4. **Tablet:** **Je tape le code** (or **Scanner** with a camera) → "On attend ton parent…".
5. **Parent:** the "Valider la tablette" sheet opens → **Associer**.
6. **Tablet:** check only Tom → **Je suis chez un ami**. The parent home updates live.
7. **Parent:** tap **Occupé·e**. The tablet shows it.
8. **Tablet:** check Léa and Tom → **Discuter** → keyboard icon → write → **Envoyer**. Then a sticker and a drawing (**Dessiner**).
9. **Parent:** Chat shows "Léa et Tom · message commun", the sticker and the drawing (tap it to see it big). Reply.
10. **Offline test:** stop the API, tap a status on the tablet ("Pas encore envoyé"), restart the API: it is sent automatically.

To pair the tablet again: on the tablet page, `F12` > Application > Local Storage > delete `swag.device`, reload.

## 7. Use it on a real phone and tablet

The tablet's development server is also a **gateway**: it forwards `/v1` (API), `/socket.io` (real time) and `/s3` (drawings, GIFs) to the local services. So one address gives access to everything. Do **not** set `VITE_API_URL` in `apps/tablet/.env` for this.

### Option A — same Wi-Fi (no account needed)

1. Put the PC, phone and tablet on the **same Wi-Fi** (school Wi-Fi often blocks this; a home box or a phone hotspot works).
2. Find the PC's IP: `ipconfig` → "IPv4 Address", e.g. `192.168.1.20`.
3. When Windows asks, allow Node.js on **private networks**.
4. Start the API and the tablet (section 5).
5. **Tablet:** open `http://192.168.1.20:5173` in Chrome (Add to Home screen for full screen). The camera needs `https`, so use **Je tape le code**.
6. **Phone:** create `apps\parent\.env` with `EXPO_PUBLIC_API_URL=http://192.168.1.20:5173`, run `pnpm --filter @swag/parent start` and scan the QR code with **Expo Go**.

### Option B — one public ngrok link (works anywhere, camera included)

1. Once: create a free account on [ngrok.com](https://ngrok.com) and run `ngrok config add-authtoken <your token>` (keep the token private).
2. Start Docker, the API and the tablet (section 5).
3. In a new terminal: `ngrok http 5173`. Copy the `https://….ngrok-free.dev` (or `.app`) link.
4. **Tablet:** open the link in Chrome, click **Visit Site** once.
5. **Phone:** create `apps\parent\.env` containing `EXPO_PUBLIC_API_URL=https://your-link.ngrok-free.dev`, then:
   ```bat
   pnpm --filter @swag/parent tunnel
   ```
   and scan the QR code with **Expo Go** (Camera app on iPhone).
6. Check: `https://your-link…/v1/health` → `"status":"ok"`. ngrok's local dashboard http://127.0.0.1:4040 shows every request.

Notes: the free link changes each time ngrok restarts (update `apps\parent\.env` and restart the parent app), unless you claim the free static domain in the ngrok dashboard and use `ngrok http --url=<domain> 5173`. Your PC must stay on with everything running. Anyone with the link can open the app: share it only with the team.

### Opening the parent app with Expo Go (step by step)

1. **On the phone:** install **Expo Go** (Play Store on Android, App Store on iPhone). No account is needed.
2. **On the PC:** start the parent app with one of these commands (from the repository folder):
   - `pnpm --filter @swag/parent start` when the phone and the PC are on the **same Wi-Fi** (most reliable);
   - `pnpm --filter @swag/parent tunnel` when they are on **different networks** (goes through Expo's tunnel, can be unstable).
3. **Wait for the QR code** in the terminal. Under it, check the address:
   - `exp://192.168.x.x:8081` or `exp://….exp.direct` → good;
   - `exp://127.0.0.1:8081` → the phone cannot reach it. Stop (`Ctrl+C`) and restart with your PC's IP:
     ```bat
     set REACT_NATIVE_PACKAGER_HOSTNAME=192.168.x.x
     pnpm --filter @swag/parent start
     ```
4. **Scan the QR code:**
   - **Android:** open Expo Go → **Scan QR code**;
   - **iPhone:** open the normal **Camera** app, point it at the QR code, tap the banner "Open in Expo Go".
5. **First opening:** Expo Go downloads the app (30 s to 1 min, a progress bar shows). The screen "Crée le compte de ta famille" appears.
6. **While you work:** every file you save reloads the app on the phone. Shake the phone to open the Expo menu (Reload, etc.).
7. **Next time:** the project appears in Expo Go's "Recently opened" list, but only works while `pnpm --filter @swag/parent start` (or `tunnel`) is running on the PC. If the address changed, remove the old entry and scan the new QR code.

Expo Go problems:

| What you see | Fix |
| --- | --- |
| "Could not connect to the server" / loads forever | Phone and PC not on the same network, or the firewall blocks port 8081: Windows Security > Firewall > "Allow an app through firewall" > tick **Node.js** for **Private**, and set your Wi-Fi to "Private network". School Wi-Fi often blocks devices from talking to each other: use the phone's hotspot for the PC. |
| `CommandError: failed to start tunnel` / `remote gone away` | Expo's tunnel service is down or blocked (antivirus such as Avast, network). Use the same-Wi-Fi command instead. |
| `@expo/ngrok … Install and try again` | Run `pnpm install` (it is a dev dependency of `apps/parent`). |
| App opens but shows "Pas de connexion au serveur SWAG" | `apps\parent\.env` has a wrong or old address: put your current ngrok link (or `http://<PC IP>:5173`), then restart the parent app. |
| "Project is incompatible with this version of Expo Go" | Update Expo Go from the store. |

### For testers who only receive a link

If someone else runs the project for you (option B), you need nothing but:
- **Tablet:** open the `https://….ngrok-free.dev` link they send you in Chrome → **Visit Site**.
- **Phone:** install **Expo Go**, then scan the QR code they show you (or open the `exp://…` link they send you in Expo Go). Their PC must stay on while you test.

### Option C — Android tablet app (Capacitor)

```bat
pnpm --filter @swag/tablet build
pnpm --filter @swag/tablet cap:sync
pnpm --filter @swag/tablet cap:open      :: Android Studio → Run on the tablet (USB debugging on)
```

Set `VITE_API_URL` in `apps\tablet\.env` before building. **Known limitation:** the Android app blocks plain `http`, so it needs either an `https` API (online or ngrok) or a development-only Capacitor change to allow cleartext. Until then, use option A or B.

## 8. Tests

| What | Command | Expected |
| --- | --- | --- |
| API end-to-end (separate `swag_test` database) | `pnpm --filter @swag/api test` | 84 tests passed |
| Shared schemas | `pnpm --filter @swag/protocol test` | all passed |
| API client | `pnpm --filter @swag/client test` | all passed |
| Types, all apps | `pnpm typecheck` | no errors |
| Lint (tablet) | `pnpm --filter @swag/tablet lint` | no errors |

Manual API calls: see the request list in [`apps/api/README.md`](apps/api/README.md) (REST Client extension in VS Code works well). Browse the database with `pnpm --filter @swag/api db:studio`.

## 9. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Docker Desktop is unable to start` | Open Docker Desktop and wait for "Engine running". Else `wsl --update`, `wsl --shutdown`, restart Docker; check Task Manager > Performance > CPU > Virtualization: Enabled. |
| `Cannot find module '../generated/prisma/client'` (166 errors) | `pnpm --filter @swag/api db:generate`, then restart the API. |
| `Cannot resolve environment variable: DATABASE_URL` | `copy apps\api\.env.example apps\api\.env` |
| Parent app: "Pas de connexion" / CORS error | Add the page's address to `CORS_ORIGINS` in `apps\api\.env` and restart the API. |
| Tablet stuck or blank | Is the API running? Open `/v1/health`. |
| "Ce code a expiré" | Codes last 10 minutes. Parent: **Nouveau code**. |
| GIFs "indisponibles" | Put a Giphy API key in `GIPHY_API_KEY` (`apps\api\.env`). |
| Drawings don't load on a device | Use the gateway (options A/B above): images go through `/s3`. |
| `@expo/ngrok … Install and try again` | Already fixed: it is a dev dependency of `apps/parent`; run `pnpm install` and use `pnpm --filter @swag/parent tunnel`. |
| `'EXPO_PUBLIC_API_URL' is not recognized` | It is a line to put **in** `apps\parent\.env`, not a command. |
| Port already in use | Close the old terminal, or change `PORT` in `apps\api\.env`. |

## 10. Status and next steps

Done:
- API: accounts, pairing (parent → QR → tablet → validation), statuses, presence, family chat with "who is speaking", stickers, GIFs, drawings, GDPR export/erasure, security hardening.
- Tablet: all screens K1–K12 (scan / code / waiting, status with chips, chat with keyboard, GIFs, stickers, drawing, offline outbox).
- Parent: P0–P7 (sign-up/login, home, family chat, drawing viewer, family and devices, QR pairing and validation).

To do:
- P8 home-screen widget (native Android code).
- Android tablet build: allow `http` in development or put the API online with `https`.
- Artwork for the "feelings", "home" and "animals" sticker packs (only the SWAG pack is drawn).
- Giphy key for GIFs; deploy the API (Scaleway, see `apps/api/README.md`) to stop depending on a PC + ngrok.
- "Sites" feature, when the team picks it up again (`FEATURE_SITES=true`).
