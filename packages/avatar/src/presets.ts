import {
  AvatarBackground,
  AvatarBrows,
  AvatarColor,
  AvatarEyes,
  AvatarFace,
  AvatarHairColor,
  AvatarHairStyle,
  AvatarMouth,
  AvatarOutfit,
  AvatarSkin,
  type AvatarSpec,
} from '@swag/protocol';

export const DEFAULT_AVATAR: AvatarSpec = {
  v: 1,
  skin: 's2',
  face: 'round',
  hair_style: 'short',
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

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length)]!;

/** A random avatar for the "Surprise" button. Never adds facial hair or glasses on its own. */
export function randomAvatar(rand: () => number = Math.random): AvatarSpec {
  return {
    v: 1,
    skin: pick(AvatarSkin.options, rand),
    face: pick(AvatarFace.options, rand),
    hair_style: pick(AvatarHairStyle.options.filter((h) => h !== 'none'), rand),
    hair_color: pick(AvatarHairColor.options, rand),
    brows: pick(AvatarBrows.options, rand),
    eyes: pick(AvatarEyes.options, rand),
    mouth: pick(AvatarMouth.options, rand),
    facial_hair: 'none',
    glasses: 'none',
    outfit: pick(AvatarOutfit.options, rand),
    outfit_color: pick(AvatarColor.options, rand),
    background: pick(AvatarBackground.options, rand),
  };
}
