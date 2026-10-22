import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  childToken,
  createChild,
  createTestApp,
  pairTablet,
  registerParent,
  type TestApp,
} from './helpers';

// A fake Giphy: two results, one of them not rated "g", plus the GIF bytes they point to.
const GIF_BYTES = Buffer.from('GIF89a-fake-gif-bytes');
let giphy: Server;
let giphyUrl: string;
const giphyRequests: string[] = [];

function startFakeGiphy(): Promise<void> {
  giphy = createServer((req, res) => {
    giphyRequests.push(req.url ?? '');
    const media = (id: string) => ({
      fixed_width_small: { url: `${giphyUrl}/media/${id}/preview.gif`, width: '100', height: '80' },
      fixed_height: { url: `${giphyUrl}/media/${id}/send.gif`, width: '250', height: '200' },
    });
    if (req.url?.startsWith('/v1/gifs/search')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            { id: 'catWave1', title: 'cat waving', rating: 'g', images: media('catWave1') },
            { id: 'notForKids', title: 'nope', rating: 'pg-13', images: media('notForKids') },
          ],
        }),
      );
    } else if (req.url?.startsWith('/media/')) {
      res.setHeader('content-type', 'image/gif');
      res.end(GIF_BYTES);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve) =>
    giphy.listen(0, '127.0.0.1', () => {
      giphyUrl = `http://127.0.0.1:${(giphy.address() as AddressInfo).port}`;
      resolve();
    }),
  );
}

let t: TestApp;
beforeAll(async () => {
  await startFakeGiphy();
  process.env.GIPHY_API_KEY = 'test-key';
  process.env.GIPHY_API_BASE = giphyUrl;
  process.env.GIPHY_MEDIA_HOST_SUFFIX = '127.0.0.1';
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  giphy.close();
});

const png = (w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 4, background: '#3D5AFE' } }).png().toBuffer();

async function childSetup() {
  const parent = await registerParent(t);
  const child = await createChild(t, parent);
  const tablet = await pairTablet(t, parent, [child.id]);
  const token = await childToken(t, tablet, child.id);
  const group = (await api(t, token).get('/conversations').expect(200)).body[0].id as string;
  return { parent, child, token, group };
}

describe('drawings (FR-11)', () => {
  it('uploads a drawing, re-encodes it, sends it, and serves it through a signed URL', async () => {
    const { parent, token, group } = await childSetup();
    const upload = await api(t, token).post('/media').attach('file', await png(), 'drawing.png').expect(201);
    expect(upload.body).toMatchObject({ mime: 'image/png', width: 64, height: 64 });

    await api(t, token)
      .post(`/conversations/${group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'drawing', media_id: upload.body.id })
      .expect(201);

    const link = await api(t, parent.token).get(`/media/${upload.body.id}`).expect(200);
    // The signed link is relative (`/v1/media/...`): the API serves the file itself, so each
    // client resolves it against the address it reached the API on. Here, the test server.
    const file = await fetch(`${t.url}${link.body.url}`);
    expect(file.ok).toBe(true);
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect(meta.format).toBe('png');
  });

  it('shrinks very large drawings to 2048 px', async () => {
    const { token } = await childSetup();
    const upload = await api(t, token).post('/media').attach('file', await png(3000, 1000), 'big.png').expect(201);
    expect(upload.body.width).toBe(2048);
  });

  it('rejects files that are not PNG or WebP images', async () => {
    const { token } = await childSetup();
    await api(t, token).post('/media').attach('file', Buffer.from('<svg onload=alert(1)>'), 'x.png').expect(400);
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
    await api(t, token).post('/media').attach('file', jpeg, 'x.jpg').expect(400);
  });

  it("cannot read or send another family's media", async () => {
    const a = await childSetup();
    const b = await childSetup();
    const upload = await api(t, a.token).post('/media').attach('file', await png(), 'd.png').expect(201);
    await api(t, b.parent.token).get(`/media/${upload.body.id}`).expect(404);
    await api(t, b.token)
      .post(`/conversations/${b.group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'drawing', media_id: upload.body.id })
      .expect(400);
  });
});

describe('GIFs through the backend (FR-11, section 5.5)', () => {
  it('searches with rating g, drops other ratings, and never exposes the API key', async () => {
    const { token } = await childSetup();
    const res = await api(t, token).get('/gifs/search?q=cat').expect(200);
    expect(res.body.items.map((i: { gif_ref: string }) => i.gif_ref)).toEqual(['catWave1']);
    expect(res.body.attribution).toBe('Powered by GIPHY');
    expect(JSON.stringify(res.body)).not.toContain('test-key');
    expect(giphyRequests.at(-1)).toContain('rating=g');
  });

  it('serves previews only through a valid signed link', async () => {
    const { token } = await childSetup();
    const res = await api(t, token).get('/gifs/search?q=cat').expect(200);
    const path: string = res.body.items[0].preview_path;
    const ok = await fetch(`${t.url}${path}`);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(GIF_BYTES);

    const forged = path.replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`);
    expect((await fetch(`${t.url}${forged}`)).status).toBe(404);
  });

  it('copies a sent GIF into our storage', async () => {
    const { parent, token, group } = await childSetup();
    await api(t, token).get('/gifs/search?q=cat').expect(200);
    const sent = await api(t, token)
      .post(`/conversations/${group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'gif', gif_ref: 'catWave1' })
      .expect(201);
    const mediaId = sent.body.message.media_id;
    expect(mediaId).toBeTypeOf('string');

    const link = await api(t, parent.token).get(`/media/${mediaId}`).expect(200);
    expect(link.body.mime).toBe('image/gif');
    expect(link.body.url).not.toContain('127.0.0.1:' + new URL(giphyUrl).port);
    expect(Buffer.from(await (await fetch(`${t.url}${link.body.url}`)).arrayBuffer())).toEqual(GIF_BYTES);
  });

  it('refuses to send a GIF that is not rated g', async () => {
    const { token, group } = await childSetup();
    await api(t, token).get('/gifs/search?q=cat').expect(200); // caches both items' metadata
    // The filtered item is not cached, so the server asks Giphy, which 404s on our fake: refused.
    await api(t, token)
      .post(`/conversations/${group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'gif', gif_ref: 'notForKids' })
      .expect(404);
  });
});
