import { describe, expect, it } from 'vitest';
import { AvatarSpec, SetAvatarInput } from './avatar';

const spec: AvatarSpec = {
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

describe('AvatarSpec', () => {
  it('accepts a complete avatar', () => {
    expect(AvatarSpec.safeParse(spec).success).toBe(true);
  });

  it('rejects a part that is not in the family-friendly list', () => {
    expect(AvatarSpec.safeParse({ ...spec, outfit: 'swimsuit' }).success).toBe(false);
  });

  it('rejects extra fields, so nothing else can be smuggled in', () => {
    expect(AvatarSpec.safeParse({ ...spec, photo: 'data:image/png;base64,AAAA' }).success).toBe(false);
  });

  it('allows clearing the avatar', () => {
    expect(SetAvatarInput.safeParse({ avatar: null }).success).toBe(true);
  });
});
