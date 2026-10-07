import { randomUUID } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetentionService } from '../src/gdpr/retention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  api,
  childToken,
  createChild,
  createTestApp,
  pairTablet,
  type Parent,
  registerParent,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const DAY = 86_400_000;

/** A family with a child, a tablet, one status, one text and one drawing. */
async function familyWithData() {
  const owner = await registerParent(t);
  const child = await createChild(t, owner, { pin: '4321' });
  const tablet = await pairTablet(t, owner, [child.id]);
  const token = await childToken(t, tablet, child.id, '4321');
  await api(t, token)
    .post(`/children/${child.id}/status`)
    .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: new Date().toISOString() })
    .expect(200);
  const group = (await api(t, token).get('/conversations').expect(200)).body[0].id as string;
  await api(t, token)
    .post(`/conversations/${group}/messages`)
    .send({ client_msg_id: randomUUID(), kind: 'text', body: 'Je suis à la maison' })
    .expect(201);
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#f00' } }).png().toBuffer();
  const upload = await api(t, token).post('/media').attach('file', png, 'd.png').expect(201);
  await api(t, token)
    .post(`/conversations/${group}/messages`)
    .send({ client_msg_id: randomUUID(), kind: 'drawing', media_id: upload.body.id })
    .expect(201);
  return { owner, child, tablet, token, group, mediaId: upload.body.id as string };
}

async function invitedParent(owner: Parent) {
  const invite = await api(t, owner.token).post('/family/invites').expect(201);
  const res = await api(t)
    .post('/family/invites/accept')
    .send({
      code: invite.body.code,
      email: `p2-${randomUUID()}@example.test`,
      password: 'another long password',
      display_name: 'Sam',
      consent: true,
      device: { name: 'Phone 2' },
    })
    .expect(201);
  return { token: res.body.tokens.access_token as string, userId: res.body.user.id as string };
}

describe('data export (right of access and portability)', () => {
  it('gives the owner a ZIP with all family data and images, without secrets', async () => {
    const { owner, mediaId } = await familyWithData();
    const res = await api(t, owner.token)
      .get('/me/export')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/zip');

    const files = unzipSync(new Uint8Array(res.body as Buffer));
    const json = strFromU8(files['data.json']!);
    const data = JSON.parse(json);
    expect(data.children).toHaveLength(1);
    expect(data.children[0].has_pin).toBe(true);
    expect(data.status_events).toHaveLength(1);
    expect(data.messages.map((m: { kind: string }) => m.kind).sort()).toEqual(['drawing', 'text']);
    expect(files[`media/${mediaId}.png`]).toBeDefined();
    for (const secret of ['password', 'pin_hash', 'credential', 'push_token', '$argon2']) {
      expect(json).not.toContain(secret);
    }
  });

  it('is refused to a parent who is not the owner', async () => {
    const { owner } = await familyWithData();
    const second = await invitedParent(owner);
    await api(t, second.token).get('/me/export').expect(403);
  });
});

describe('erasure (right to be forgotten)', () => {
  it('erases everything after the 7-day window, and can be cancelled before', async () => {
    const { owner, tablet } = await familyWithData();
    const prisma = t.app.get(PrismaService);
    const retention = t.app.get(RetentionService);

    const scheduled = await api(t, owner.token).delete('/family').expect(202);
    expect(new Date(scheduled.body.erasure_scheduled_for).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);

    // Cancelled: the nightly job 8 days later leaves the family alone.
    await api(t, owner.token).post('/family/erasure/cancel').expect(204);
    await retention.run(new Date(Date.now() + 8 * DAY));
    expect(await prisma.family.count({ where: { id: owner.familyId } })).toBe(1);

    // Requested again and left to run.
    await api(t, owner.token).delete('/family').expect(202);
    await retention.run(new Date(Date.now() + 6 * DAY));
    expect(await prisma.family.count({ where: { id: owner.familyId } })).toBe(1);
    const media = await prisma.mediaObject.findMany({ where: { familyId: owner.familyId } });
    await retention.run(new Date(Date.now() + 8 * DAY));

    expect(await prisma.family.count({ where: { id: owner.familyId } })).toBe(0);
    expect(await prisma.user.count({ where: { familyId: owner.familyId } })).toBe(0);
    expect(await prisma.mediaObject.count({ where: { familyId: owner.familyId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { familyId: owner.familyId } })).toBe(0);
    await api(t, tablet.deviceToken).get('/device/profiles').expect(401);
    // The stored drawing is gone from the bucket too.
    expect(media).toHaveLength(1);
  });

  it('only the owner can request erasure', async () => {
    const { owner } = await familyWithData();
    const second = await invitedParent(owner);
    await api(t, second.token).delete('/family').expect(403);
  });
});

describe('membership', () => {
  it('the owner can remove a parent, whose session stops working at once', async () => {
    const { owner } = await familyWithData();
    const second = await invitedParent(owner);
    await api(t, second.token).get('/family').expect(200);
    await api(t, owner.token).delete(`/family/members/${second.userId}`).expect(204);
    await api(t, second.token).get('/family').expect(401);
    expect((await api(t, owner.token).get('/family').expect(200)).body.parents).toHaveLength(1);
  });

  it('a parent can leave, but cannot remove the owner or someone else', async () => {
    const { owner } = await familyWithData();
    const second = await invitedParent(owner);
    const third = await invitedParent(owner);
    await api(t, second.token).delete(`/family/members/${owner.userId}`).expect(409);
    await api(t, second.token).delete(`/family/members/${third.userId}`).expect(403);
    await api(t, second.token).delete(`/family/members/${second.userId}`).expect(204);
  });
});

describe('retention (storage limitation)', () => {
  it("deletes statuses past the family's retention but keeps the current one", async () => {
    const { owner, child, token } = await familyWithData();
    await api(t, owner.token).patch('/family').send({ status_retention_days: 2 }).expect(200);
    for (const daysAgo of [10, 5]) {
      await api(t, token)
        .post(`/children/${child.id}/status`)
        .send({
          client_event_id: randomUUID(),
          status: 'left_home',
          occurred_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
        })
        .expect(200);
    }
    const prisma = t.app.get(PrismaService);
    expect(await prisma.statusEvent.count({ where: { childProfileId: child.id } })).toBe(3);

    await t.app.get(RetentionService).run();
    const left = await prisma.statusEvent.findMany({ where: { childProfileId: child.id } });
    expect(left).toHaveLength(1);
    const overview = await api(t, owner.token).get('/family/overview').expect(200);
    expect(overview.body.children[0].status.event_id).toBe(left[0]!.id);
  });

  it('deletes old messages and the drawings they pointed to', async () => {
    const { owner, mediaId } = await familyWithData();
    await api(t, owner.token).patch('/family').send({ message_retention_days: 30 }).expect(200);
    const prisma = t.app.get(PrismaService);
    await t.app.get(RetentionService).run(new Date(Date.now() + 31 * DAY));
    expect(await prisma.message.count({ where: { familyId: owner.familyId } })).toBe(0);
    expect(await prisma.mediaObject.count({ where: { id: mediaId } })).toBe(0);
  });
});
