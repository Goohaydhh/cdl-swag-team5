import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  childToken,
  connectSocket,
  createChild,
  createTestApp,
  nextEvent,
  pairTablet,
  registerParent,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function setup() {
  const parent = await registerParent(t);
  const lea = await createChild(t, parent, { display_name: 'Léa' });
  const tom = await createChild(t, parent, { display_name: 'Tom' });
  const tablet = await pairTablet(t, parent, [lea.id]);
  return { parent, lea, tom, tablet };
}

describe('allowed websites (FR-9)', () => {
  it('stores normalised rules and refuses public suffixes and duplicates', async () => {
    const { parent } = await setup();
    const added = await api(t, parent.token)
      .post('/allowed-urls')
      .send({ url: 'https://www.YouTube.com/kids/', match: 'prefix', title: 'YouTube Kids' })
      .expect(201);
    expect(added.body).toMatchObject({ host: 'www.youtube.com', path_prefix: '/kids', match: 'prefix' });

    await api(t, parent.token).post('/allowed-urls').send({ url: 'co.uk' }).expect(400);
    await api(t, parent.token).post('/allowed-urls').send({ url: 'http://example.com' }).expect(400);
    await api(t, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(201);
    await api(t, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(409);
  });

  it("gives the tablet family-wide rules plus its own children's, not other children's", async () => {
    const { parent, lea, tom, tablet } = await setup();
    await api(t, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(201);
    await api(t, parent.token).post('/allowed-urls').send({ url: 'lumni.fr', child_id: lea.id }).expect(201);
    await api(t, parent.token).post('/allowed-urls').send({ url: 'minecraft.net', child_id: tom.id }).expect(201);

    const hosts = async (token: string) =>
      (await api(t, token).get('/device/allowed-urls').expect(200)).body.items.map((i: { host: string }) => i.host).sort();
    expect(await hosts(tablet.deviceToken)).toEqual(['lumni.fr', 'wikipedia.org']);
    expect(await hosts(await childToken(t, tablet, lea.id))).toEqual(['lumni.fr', 'wikipedia.org']);
  });

  it('answers 304 when the tablet already has the current version', async () => {
    const { parent, tablet } = await setup();
    await api(t, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(201);
    const first = await api(t, tablet.deviceToken).get('/device/allowed-urls').expect(200);
    const etag = first.headers.etag!;
    await api(t, tablet.deviceToken).get('/device/allowed-urls').set('If-None-Match', etag).expect(304);

    await api(t, parent.token).post('/allowed-urls').send({ url: 'lumni.fr' }).expect(201);
    await api(t, tablet.deviceToken).get('/device/allowed-urls').set('If-None-Match', etag).expect(200);
  });

  it('tells connected tablets when the list changes', async () => {
    const { parent, tablet } = await setup();
    const socket = await connectSocket(t, tablet.deviceToken);
    const changed = nextEvent<{ data: { version: number } }>(socket, 'allowed_urls_changed');
    const added = await api(t, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(201);
    const v1 = (await changed).data.version;

    const removed = nextEvent<{ data: { version: number } }>(socket, 'allowed_urls_changed');
    await api(t, parent.token).delete(`/allowed-urls/${added.body.id}`).expect(204);
    expect((await removed).data.version).toBe(v1 + 1);
    socket.close();
  });

  it('a tablet cannot edit the allowlist', async () => {
    const { tablet } = await setup();
    await api(t, tablet.deviceToken).post('/allowed-urls').send({ url: 'evil.com' }).expect(403);
  });
});

describe('"Ask to open" (FR-9)', () => {
  it('reaches the parents, not the other children', async () => {
    const { parent, lea, tablet } = await setup();
    const parentSocket = await connectSocket(t, parent.token);
    const leaToken = await childToken(t, tablet, lea.id);
    const leaSocket = await connectSocket(t, leaToken);
    let childHeard = false;
    leaSocket.on('url_access_requested', () => (childHeard = true));

    const heard = nextEvent<{ data: { child_id: string; url: string } }>(parentSocket, 'url_access_requested');
    const ack = await leaSocket.emitWithAck('url_access_request', { url: 'https://www.Minecraft.net/fr-fr' });
    expect(ack.ok).toBe(true);
    expect((await heard).data).toMatchObject({ child_id: lea.id, url: 'https://www.minecraft.net/fr-fr' });
    await new Promise((r) => setTimeout(r, 200));
    expect(childHeard).toBe(false);
    for (const s of [parentSocket, leaSocket]) s.close();
  });
});

describe('sites are paused by default (product decision)', () => {
  it('answers 404 on every sites route when FEATURE_SITES is off', async () => {
    const previous = process.env.FEATURE_SITES;
    process.env.FEATURE_SITES = 'false';
    const off = await createTestApp();
    try {
      const parent = await registerParent(off);
      const child = await createChild(off, parent);
      const tablet = await pairTablet(off, parent, [child.id]);
      await api(off, parent.token).get('/allowed-urls').expect(404);
      await api(off, parent.token).post('/allowed-urls').send({ url: 'wikipedia.org' }).expect(404);
      await api(off, tablet.deviceToken).get('/device/allowed-urls').expect(404);
      const token = await childToken(off, tablet, child.id);
      const socket = await connectSocket(off, token);
      const ack = await socket.emitWithAck('url_access_request', { url: 'https://minecraft.net' });
      expect(ack).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      socket.close();
    } finally {
      process.env.FEATURE_SITES = previous;
      await off.close();
    }
  });
});
