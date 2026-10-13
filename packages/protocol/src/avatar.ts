import { z } from 'zod';

// Custom avatars ("Créer mon avatar"). An avatar is only a list of choices drawn by
// @swag/avatar: no photo is ever uploaded or stored. Every part comes from a closed list,
// so the server rejects anything that is not one of the family-friendly options below.

export const AvatarSkin = z.enum(['s1', 's2', 's3', 's4', 's5', 's6']);
export const AvatarFace = z.enum(['round', 'oval', 'square']);
export const AvatarHairStyle = z.enum(['short', 'buzz', 'curly', 'long', 'bun', 'braids', 'headscarf', 'none']);
export const AvatarHairColor = z.enum(['black', 'brown', 'auburn', 'blond', 'grey', 'purple', 'pink']);
export const AvatarBrows = z.enum(['soft', 'straight', 'raised']);
export const AvatarEyes = z.enum(['round', 'happy', 'almond', 'big']);
export const AvatarMouth = z.enum(['smile', 'grin', 'calm', 'open']);
export const AvatarFacialHair = z.enum(['none', 'mustache', 'beard']);
export const AvatarGlasses = z.enum(['none', 'round', 'square']);
export const AvatarOutfit = z.enum(['tshirt', 'hoodie', 'sweater', 'shirt', 'dungarees']);
export const AvatarColor = z.enum(['purple', 'green', 'orange', 'blue', 'yellow', 'pink', 'red', 'grey']);
export const AvatarBackground = z.enum(['lavender', 'mint', 'peach', 'sky', 'sun', 'rose']);

export const AvatarSpec = z
  .object({
    v: z.literal(1),
    skin: AvatarSkin,
    face: AvatarFace,
    hair_style: AvatarHairStyle,
    hair_color: AvatarHairColor,
    brows: AvatarBrows,
    eyes: AvatarEyes,
    mouth: AvatarMouth,
    facial_hair: AvatarFacialHair,
    glasses: AvatarGlasses,
    outfit: AvatarOutfit,
    /** Outfit colour; also the colour of the headscarf. */
    outfit_color: AvatarColor,
    background: AvatarBackground,
  })
  .strict();
export type AvatarSpec = z.infer<typeof AvatarSpec>;

/** PUT /me/avatar and PUT /children/:id/avatar. `null` goes back to the default picture. */
export const SetAvatarInput = z.object({ avatar: AvatarSpec.nullable() });
export type SetAvatarInput = z.infer<typeof SetAvatarInput>;
