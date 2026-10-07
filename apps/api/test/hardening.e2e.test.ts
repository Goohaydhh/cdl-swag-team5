import { exportPKCS8, generateKeyPair } from 'jose';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KeysService } from '../src/auth/keys.service';
import { loadEnv } from '../src/config/env';
import { api, createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('HTTP hardening', () => {
  it('health reports database and Redis', async () => {
    const res = await api(t).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('sends security headers and hides the framework', async () => {
    const res = await api(t).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins', async () => {
    const ok = await api(t).get('/health').set('Origin', 'https://localhost').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://localhost');
    const evil = await api(t).get('/health').set('Origin', 'https://evil.example').expect(200);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies with the standard error format', async () => {
    const res = await api(t)
      .post('/auth/login')
      .send({ email: 'a@b.test', password: 'x'.repeat(200 * 1024) })
      .expect(413);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('never leaks internals on unknown routes', async () => {
    const res = await api(t).get('/does-not-exist').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

describe('JWT key rotation', () => {
  async function keyFile(dir: string) {
    const path = join(dir, `${randomUUID()}.pem`);
    const pair = await generateKeyPair('ES256', { extractable: true });
    writeFileSync(path, await exportPKCS8(pair.privateKey));
    return path;
  }

  async function keys(current: string, previous?: string) {
    const env = loadEnv({ ...process.env, JWT_PRIVATE_KEY_PATH: current, JWT_PREVIOUS_KEY_PATH: previous });
    const service = new KeysService(env);
    await service.onModuleInit();
    return service;
  }

  it('keeps old tokens valid during a rotation, and only then', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swag-keys-'));
    const oldKey = await keyFile(dir);
    const newKey = await keyFile(dir);
    const claims = { sub: randomUUID(), fam: randomUUID(), scope: 'parent' as const };

    const before = await keys(oldKey);
    const token = await before.sign(claims, 900);

    const during = await keys(newKey, oldKey);
    expect(await during.verify(token)).toMatchObject(claims);
    expect(await during.verify(await during.sign(claims, 900))).toMatchObject(claims);

    const after = await keys(newKey);
    expect(await after.verify(token)).toBeNull();
  });
});
