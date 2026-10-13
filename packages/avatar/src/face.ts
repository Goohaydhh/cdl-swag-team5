import type { AvatarSpec } from '@swag/protocol';
import { HAIR, hexToRgb, NATURAL_HAIR, type Rgb, SKIN } from './palette';

/**
 * Measurements taken on the device from one camera frame (see the tablet's AvatarCamera).
 * Only these few numbers are used; the frame itself is thrown away and never leaves the device.
 */
export interface FaceSample {
  /** Average colour of both cheeks. */
  skin: Rgb;
  /** Average colour just above the forehead, or null if it was not visible. */
  hair: Rgb | null;
  /** Face width (cheekbone to cheekbone) divided by face height (forehead to chin). */
  widthToHeight: number;
  /** Jaw width divided by cheekbone width: close to 1 for a square jaw. */
  jawToCheek: number;
}

const dist = (a: Rgb, b: Rgb) => {
  // "Redmean" approximation: cheap and much closer to how eyes compare colours than plain RGB.
  const rm = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};

function nearest<K extends string>(rgb: Rgb, palette: Record<K, string>, keys: K[]): K {
  let best = keys[0]!;
  let bestD = Infinity;
  for (const k of keys) {
    const d = dist(rgb, hexToRgb(palette[k]));
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}

/** Skin tone, hair colour and face shape guessed from a sample. The child can change all of them. */
export function suggestFromFace(sample: FaceSample): Partial<AvatarSpec> {
  const out: Partial<AvatarSpec> = {
    skin: nearest(sample.skin, SKIN, Object.keys(SKIN) as AvatarSpec['skin'][]),
    face: sample.jawToCheek >= 0.86 ? 'square' : sample.widthToHeight >= 0.84 ? 'round' : 'oval',
  };
  // Above the forehead looks like skin: probably no hair (or a hat), so keep the current style.
  if (sample.hair && dist(sample.hair, sample.skin) > 120) {
    out.hair_color = nearest(sample.hair, HAIR, NATURAL_HAIR);
  }
  return out;
}
