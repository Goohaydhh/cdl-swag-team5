import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, childToken, createChild, createTestApp, pairTablet, registerParent, type TestApp } from './helpers';

const avatar = {
  v: 1,
  skin: 's3',
  face: 'round',
  hair_style: 'curly',
  hair_color: 'brown',
  brows: 'soft',
  eyes: 'round',
  mouth: 'smile',
  facial_hair: 'none',
  glasses: 'none',
  outfit: 'hoodie',
  outfit_color: 'purple',
  background: 'lavender',
};

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('custom avatars', () => {
  it('a parent sets their own avatar; the family sees it, then it can be cleared', async () => {
    const parent = await registerParent(t);
    await api(t, parent.token).put('/me/avatar').send({ avatar }).expect(200);

    const overview = await api(t, parent.token).get('/family/overview').expect(200);
    expect(overview.body.parents[0].avatar_spec).toEqual(avatar);

    await api(t, parent.token).put('/me/avatar').send({ avatar: null }).expect(200);
    const family = await api(t, parent.token).get('/family').expect(200);
    expect(family.body.parents[0].avatar_spec).toBeNull();
  });

  it('rejects parts outside the family-friendly list and anything that looks like a photo', async () => {
    const parent = await registerParent(t);
    await api(t, parent.token).put('/me/avatar').send({ avatar: { ...avatar, outfit: 'swimsuit' } }).expect(400);
    await api(t, parent.token)
      .put('/me/avatar')
      .send({ avatar: { ...avatar, photo: 'data:image/jpeg;base64,AAAA' } })
      .expect(400);
  });

  it('a tablet sets the avatar of its own children only', async () => {
    const parent = await registerParent(t);
    const lea = await createChild(t, parent);
    const tom = await createChild(t, parent, { display_name: 'Tom' });
    const tablet = await pairTablet(t, parent, [lea.id]);

    const res = await api(t, tablet.deviceToken).put(`/children/${lea.id}/avatar`).send({ avatar }).expect(200);
    expect(res.body.avatar_spec).toEqual(avatar);
    await api(t, tablet.deviceToken).put(`/children/${tom.id}/avatar`).send({ avatar }).expect(404);

    const profiles = await api(t, tablet.deviceToken).get('/device/profiles').expect(200);
    expect(profiles.body.children[0].avatar_spec).toEqual(avatar);
  });

  it('a child session cannot change avatars, and other families are out of reach', async () => {
    const parent = await registerParent(t);
    const lea = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [lea.id]);
    const child = await childToken(t, tablet, lea.id);
    await api(t, child).put(`/children/${lea.id}/avatar`).send({ avatar }).expect(403);

    const stranger = await registerParent(t);
    await api(t, stranger.token).put(`/children/${lea.id}/avatar`).send({ avatar }).expect(404);
  });

  it('only a parent can allow the camera for a child', async () => {
    const parent = await registerParent(t);
    const lea = await createChild(t, parent);
    const created = await api(t, parent.token).get('/children').expect(200);
    expect(created.body[0].avatar_camera_allowed).toBe(false);

    const res = await api(t, parent.token).patch(`/children/${lea.id}`).send({ avatar_camera_allowed: true }).expect(200);
    expect(res.body.avatar_camera_allowed).toBe(true);

    const tablet = await pairTablet(t, parent, [lea.id]);
    await api(t, tablet.deviceToken).patch(`/children/${lea.id}`).send({ avatar_camera_allowed: true }).expect(403);
  });
});
