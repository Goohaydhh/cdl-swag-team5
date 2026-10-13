import type { AvatarSpec } from '@swag/protocol';

export const INK = '#2A1B4D';

export const SKIN: Record<AvatarSpec['skin'], string> = {
  s1: '#FBE0CF',
  s2: '#F3C9A8',
  s3: '#E0A97F',
  s4: '#BF8358',
  s5: '#8F5B3A',
  s6: '#5C3926',
};

export const HAIR: Record<AvatarSpec['hair_color'], string> = {
  black: '#2B2233',
  brown: '#6B4226',
  auburn: '#A84A26',
  blond: '#E3B65A',
  grey: '#B3AEBB',
  purple: '#7B5CFF',
  pink: '#F27BB0',
};

export const CLOTHES: Record<AvatarSpec['outfit_color'], string> = {
  purple: '#6B4EFF',
  green: '#3DBE7A',
  orange: '#FF8A3D',
  blue: '#3B9BF0',
  yellow: '#FFC933',
  pink: '#F27BB0',
  red: '#E5484D',
  grey: '#8A8798',
};

export const BACKGROUND: Record<AvatarSpec['background'], string> = {
  lavender: '#E9E4FF',
  mint: '#DDF5E8',
  peach: '#FFE7D6',
  sky: '#DCEEFF',
  sun: '#FFF3C4',
  rose: '#FFE1EE',
};

/** Hair colours a camera can suggest (the fun ones are only picked by hand). */
export const NATURAL_HAIR: AvatarSpec['hair_color'][] = ['black', 'brown', 'auburn', 'blond', 'grey'];

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Mixes `hex` towards black (amount > 0) or white (amount < 0). */
export function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(hexToRgb(hex).map((v) => v + (target - v) * t) as Rgb);
}
