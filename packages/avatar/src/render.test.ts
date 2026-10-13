import {
  AvatarEyes,
  AvatarFace,
  AvatarGlasses,
  AvatarHairStyle,
  AvatarMouth,
  AvatarOutfit,
  type AvatarSpec,
  AvatarSpec as AvatarSpecSchema,
} from '@swag/protocol';
import { describe, expect, it } from 'vitest';
import { AVATAR_CATEGORIES } from './catalog';
import { suggestFromFace } from './face';
import { DEFAULT_AVATAR, randomAvatar } from './presets';
import { renderAvatar } from './render';

describe('renderAvatar', () => {
  it('draws every combination of the main parts without NaN or empty shapes', () => {
    for (const face of AvatarFace.options)
      for (const hair_style of AvatarHairStyle.options)
        for (const outfit of AvatarOutfit.options) {
          const shapes = renderAvatar({ ...DEFAULT_AVATAR, face, hair_style, outfit, facial_hair: 'beard', glasses: 'round' });
          expect(shapes.length).toBeGreaterThan(8);
          for (const s of shapes) {
            expect(JSON.stringify(s.props)).not.toMatch(/NaN|undefined|null/);
          }
        }
  });

  it('changes the drawing for every eye, mouth and glasses option', () => {
    const seen = new Set<string>();
    for (const eyes of AvatarEyes.options) seen.add(JSON.stringify(renderAvatar({ ...DEFAULT_AVATAR, eyes })));
    for (const mouth of AvatarMouth.options) seen.add(JSON.stringify(renderAvatar({ ...DEFAULT_AVATAR, mouth })));
    for (const glasses of AvatarGlasses.options) seen.add(JSON.stringify(renderAvatar({ ...DEFAULT_AVATAR, glasses })));
    // Defaults appear once in each loop, so 4 eyes + 3 other mouths + 2 other glasses.
    expect(seen.size).toBe(AvatarEyes.options.length + AvatarMouth.options.length - 1 + AvatarGlasses.options.length - 1);
  });
});

describe('presets', () => {
  it('random avatars are always valid and never add facial hair', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const a: AvatarSpec = randomAvatar(rand);
      expect(AvatarSpecSchema.safeParse(a).success).toBe(true);
      expect(a.facial_hair).toBe('none');
    }
  });
});

describe('suggestFromFace', () => {
  it('maps a light skin and dark hair to the nearest palette entries', () => {
    const s = suggestFromFace({ skin: [250, 222, 205], hair: [40, 32, 45], widthToHeight: 0.8, jawToCheek: 0.75 });
    expect(s).toMatchObject({ skin: 's1', hair_color: 'black', face: 'oval' });
  });

  it('does not guess a hair colour when the forehead area looks like skin', () => {
    const s = suggestFromFace({ skin: [143, 91, 58], hair: [150, 95, 62], widthToHeight: 0.9, jawToCheek: 0.8 });
    expect(s.hair_color).toBeUndefined();
    expect(s.face).toBe('round');
    expect(s.skin).toBe('s5');
  });

  it('only suggests natural hair colours', () => {
    const s = suggestFromFace({ skin: [240, 200, 170], hair: [123, 92, 255], widthToHeight: 0.8, jawToCheek: 0.9 });
    expect(['black', 'brown', 'auburn', 'blond', 'grey']).toContain(s.hair_color);
    expect(s.face).toBe('square');
  });
});

describe('AVATAR_CATEGORIES', () => {
  it('offers exactly the values the server accepts, for every part', () => {
    const shape = AvatarSpecSchema.shape;
    const keys = AVATAR_CATEGORIES.map((c) => c.key).sort();
    expect(keys).toEqual(Object.keys(shape).filter((k) => k !== 'v').sort());
    for (const c of AVATAR_CATEGORIES) {
      expect(c.options.map((o) => o.value).sort()).toEqual([...(shape[c.key] as { options: string[] }).options].sort());
    }
  });
});
