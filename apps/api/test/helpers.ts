import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export interface TestApp {
  app: INestApplication;
  url: string;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  await configureApp(app);
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** Every call looks like a different client, so per-IP rate limits don't trip across tests. */
export const freshIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export function api(t: TestApp, token?: string) {
  const agent = request(t.url);
  const wrap = (r: request.Test) => {
    r.set('X-Forwarded-For', freshIp());
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r;
  };
  return {
    get: (path: string) => wrap(agent.get(`/v1${path}`)),
    post: (path: string) => wrap(agent.post(`/v1${path}`)),
    patch: (path: string) => wrap(agent.patch(`/v1${path}`)),
    put: (path: string) => wrap(agent.put(`/v1${path}`)),
    delete: (path: string) => wrap(agent.delete(`/v1${path}`)),
  };
}

export interface Parent {
  token: string;
  refresh: string;
  userId: string;
  familyId: string;
  email: string;
}

export async function registerParent(t: TestApp, overrides: Record<string, unknown> = {}): Promise<Parent> {
  const email = `parent-${randomUUID()}@example.test`;
  const res = await api(t)
    .post('/auth/register')
    .send({
      email,
      password: 'correct horse battery',
      display_name: 'Alex',
      family_name: 'Martin',
      consent: true,
      device: { name: 'Pixel 8' },
      ...overrides,
    })
    .expect(201);
  return {
    token: res.body.tokens.access_token,
    refresh: res.body.tokens.refresh_token,
    userId: res.body.user.id,
    familyId: res.body.user.family_id,
    email,
  };
}

export async function createChild(t: TestApp, parent: Parent, body: Record<string, unknown> = {}) {
  const res = await api(t, parent.token)
    .post('/children')
    .send({ display_name: 'Léa', avatar_key: 'fox', color: '#FF7043', ...body })
    .expect(201);
  return res.body as { id: string; has_pin: boolean };
}

export interface PairedTablet {
  deviceId: string;
  credential: string;
  deviceToken: string;
}

/** Runs the full tablet pairing flow and returns a working device token. */
export async function pairTablet(t: TestApp, parent: Parent, childIds: string[]): Promise<PairedTablet> {
  const session = await api(t)
    .post('/pairing/sessions')
    .send({ device_info: { model: 'Redmi Pad 2' } })
    .expect(201);
  const { pairing_id, code, poll_secret } = session.body;

  await api(t, parent.token).post('/pairing/claim').send({ code }).expect(200);
  await api(t, parent.token)
    .post(`/pairing/sessions/${pairing_id}/approve`)
    .send({ device_name: 'Kitchen tablet', child_ids: childIds })
    .expect(200);
  const polled = await api(t)
    .get(`/pairing/sessions/${pairing_id}?wait=0`)
    .set('X-Pairing-Secret', poll_secret)
    .expect(200);

  const token = await api(t)
    .post('/device/token')
    .send({ device_id: polled.body.device_id, credential: polled.body.credential })
    .expect(200);
  return {
    deviceId: polled.body.device_id,
    credential: token.body.credential,
    deviceToken: token.body.access_token,
  };
}

export async function childToken(t: TestApp, tablet: PairedTablet, childId: string, pin?: string) {
  const res = await api(t, tablet.deviceToken)
    .post('/device/child-session')
    .send({ child_id: childId, ...(pin ? { pin } : {}) })
    .expect(200);
  return res.body.access_token as string;
}

/** Connects to /rt and resolves once connected, or rejects if the server drops the socket. */
export function connectSocket(t: TestApp, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${t.url}/rt`, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    socket.on('connect', () => {
      // The server authenticates after the transport connects; give it a moment to reject.
      setTimeout(() => {
        clearTimeout(timer);
        if (socket.connected) resolve(socket);
        else reject(new Error('socket rejected'));
      }, 150);
    });
    socket.on('disconnect', () => {
      clearTimeout(timer);
      reject(new Error('socket rejected'));
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeoutMs}ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
