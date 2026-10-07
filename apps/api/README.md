# SWAG API

NestJS 12 + Socket.IO + Prisma 7 (PostgreSQL 16) + Redis 7 + S3 storage. Implements sections 4 to 7 of the Technical Architecture Document. Shared request schemas and event types live in `packages/protocol`.

## Run locally

```bat
pnpm db:up                                   :: from the repo root: Postgres, Redis, S3 (RustFS)
copy apps\api\.env.example apps\api\.env
pnpm --filter @swag/api db:migrate
pnpm --filter @swag/api dev                  :: http://localhost:3100/v1
pnpm --filter @swag/api seed:dev             :: demo family + working credentials for the apps
pnpm --filter @swag/api test                 :: end-to-end tests (separate swag_test DB, Redis DB 1, swag-test bucket)
```

A development JWT key is generated in `apps/api/keys/` on first start (git-ignored).

## REST API (`/v1`)

Errors always look like `{ "error": { "code": "VALIDATION", "message": "…" } }`. Routes need `Authorization: Bearer <access token>` unless marked public. Token scopes: `parent`, `device` (paired tablet), `child` (a child profile picked on the tablet).

| Area | Method and path | Scope | Notes |
| --- | --- | --- | --- |
| Health | `GET /health` | public | 200 only if Postgres and Redis answer |
| Auth | `POST /auth/register` | public | Creates family + owner; `consent: true` required |
| Auth | `POST /auth/login` | public | Optional `device` creates the phone record (for push) |
| Auth | `POST /auth/refresh` | public | Rotates; replaying an old token revokes the chain |
| Auth | `POST /auth/logout` | parent | Revokes refresh chain and the phone |
| Pairing | `POST /pairing/sessions` | public | Tablet: returns `code`, `qr_payload`, `poll_secret` (5 min) |
| Pairing | `GET /pairing/sessions/:id?wait=25` | public | Tablet long-poll, header `X-Pairing-Secret`; credential returned once |
| Pairing | `POST /pairing/claim` | parent | `{ code, pairing_id? }`; 5 wrong codes lock a QR session |
| Pairing | `POST /pairing/sessions/:id/approve` \| `/reject` | parent | `{ device_name, child_ids }` |
| Invites | `POST /family/invites`, `POST /family/invites/accept` | parent, public | Second parent joins with the code (24 h) |
| Family | `GET`, `PATCH /family` | parent | Name, retention days |
| Children | `GET`, `POST /children`, `PATCH`, `DELETE /children/:id` | parent | Optional 4-digit `pin` |
| Devices | `GET /devices`, `PATCH`, `DELETE /devices/:id` | parent | Assign children to a tablet; revoke = instant cut-off |
| Tablet | `POST /device/token` | public | `{ device_id, credential }` → access token + **rotated** credential |
| Tablet | `GET /device/profiles` | device | Children on this tablet + parents |
| Tablet | `POST /device/child-session` | device | `{ child_id, pin? }` → child token (30 min) |
| Status | `POST /children/:id/status` | child | REST fallback of `status_update`; idempotent |
| Status | `GET /family/overview` | parent | Children's current status + parents' presence (widget) |
| Status | `GET /children/:id/status-history?cursor=&limit=` | parent | Newest first |
| Presence | `PUT /me/availability`, `PUT /me/ringer` | parent | REST fallbacks of the socket events |
| Push | `PUT /devices/me/push-token` | parent | FCM token for this phone (`null` clears) |
| Chat | `GET`, `POST /conversations` | parent, child | Group chat + direct parent-child threads |
| Chat | `GET /conversations/:id/messages?before=&limit=` | parent, child | Newest first |
| Chat | `POST /conversations/:id/messages` | parent, child | REST fallback of `chat_message`; idempotent |
| Chat | `GET /stickers/packs` | parent, child | Built-in catalogue |
| Media | `POST /media` (multipart `file`) | parent, child | PNG/WebP ≤ 1 MB, re-encoded to PNG ≤ 2048 px |
| Media | `GET /media/:id` | parent, child | 5-minute signed URL |
| GIFs | `GET /gifs/search?q=` | parent, child | Giphy via backend, rating g; signed `preview_path` |
| Allowlist | `GET`, `POST /allowed-urls`, `DELETE /allowed-urls/:id` | parent | Rules from `buildAllowlistRule` |
| Allowlist | `GET /device/allowed-urls` | device, child | ETag / `If-None-Match` for offline caching |
| GDPR | `GET /me/export` | parent (owner) | ZIP: `data.json` + images, no secrets |
| GDPR | `DELETE /family`, `POST /family/erasure/cancel` | parent (owner) | Erasure after a 7-day undo window |
| GDPR | `DELETE /family/members/:userId` | parent | Owner removes a parent, or a parent leaves |

## Socket.IO (`/rt`)

Connect with `io(url + '/rt', { auth: { token } })`. Every client event takes an ack `{ ok: true, server_ts, … }` or `{ ok: false, error: { code, message, retryable } }`. Server events are wrapped in `{ v: 1, seq, ts, data }`; after a reconnect send `sync_request { since_seq }` to replay what was missed (24 h), or handle `resync_required` by re-reading over REST. Types: `packages/protocol/src/events.ts`.

- **Client → server:** `status_update`, `parent_availability`, `ringer_status`, `chat_message`, `chat_typing`, `chat_read`, `url_access_request`, `sync_request`, `reauth`
- **Server → client:** `status_updated`, `availability_updated`, `ringer_updated`, `chat_message_created`, `chat_typing`, `chat_read`, `allowed_urls_changed`, `profiles_changed`, `presence`, `device_revoked`, `auth_expiring`, `resync_required`, `url_access_requested` (parents only)

## Environment

See `.env.example` (local) and `deploy/.env.production.example` (Scaleway). Required: `DATABASE_URL`, `REDIS_URL`, `PAIRING_CODE_PEPPER`, `S3_*`. Optional: `GIPHY_API_KEY` (else GIF search answers 503), `FCM_SERVICE_ACCOUNT_PATH` (else pushes are only recorded in memory), `JWT_PREVIOUS_KEY_PATH` (during a key rotation), `CORS_ORIGINS`, `TRUST_PROXY_HOPS`. Production refuses to start with a weak pepper, a missing JWT key, or `ALLOW_DEV_TOKENS=true`.

## Deploy (Scaleway, fr-par)

1. Create Managed PostgreSQL 16, Managed Redis and an Object Storage bucket in fr-par; an Instance with Docker.
2. On the Instance: copy `deploy/.env.production.example` to `deploy/.env.production`, fill it, and put `jwt-es256.pem` (and `fcm-service-account.json`) in `deploy/secrets/`.
3. `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production run --rm migrate`
4. `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build`

## Notes for future migrations

Three indexes are written by hand because Prisma's schema language cannot express them: the partial unique index on live pairing codes, one group conversation per family, and `NULLS NOT DISTINCT` on the allowlist. `prisma migrate dev` keeps them as long as their names are unchanged; check generated migrations for unexpected `DROP INDEX` lines. In a non-interactive shell, generate SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` and apply with `prisma migrate deploy`.
