// SWAG design tokens: "warm and joyful", from the Figma file and the clickable prototype
// (design team, October 2026). Shared by the parent phone (React Native) and the child
// tablet (React web). Keep names stable: the apps import them directly.

/** Base palette. */
export const color = {
  /** Text and the night surfaces (widget, QR scanner). */
  ink: '#2A1B4D',
  inkSoft: '#5F5380',
  inkInverse: '#FFFFFF',
  background: '#F7F4FF',
  surface: '#FFFFFF',
  border: '#E4DCF7',
  night: '#2A1B4D',
  primary: '#6B4EFF',
  primaryDeep: '#4A32C9',
  primarySoft: '#E9E4FF',
  sun: '#FFC933',
  sunSoft: '#FFF1C2',
  danger: '#C92A2A',
  // Aliases kept for code written against the Sprint 0 placeholders.
  textPrimary: '#2A1B4D',
  textSecondary: '#5F5380',
} as const;

/** One colour per child status: tablet tiles, parent chips and the widget. */
export const statusColor = {
  at_home: '#0B8F55',
  left_home: '#D9480F',
  at_friend: '#1971C2',
} as const;

/** Light background behind a status chip. */
export const statusSoftColor = {
  at_home: '#D9F5E7',
  left_home: '#FFE3D3',
  at_friend: '#D8EAFB',
} as const;

/** French labels, as written in the designs. */
export const statusLabel = {
  at_home: 'À la maison',
  left_home: 'Parti de la maison',
  at_friend: 'Chez un ami',
} as const;

/** What the child taps on the tablet ("I am…"). */
export const statusChildLabel = {
  at_home: 'Je suis à la maison',
  left_home: 'Je suis parti',
  at_friend: 'Je suis chez un ami',
} as const;

/** Short labels for the home-screen widget. */
export const statusShortLabel = {
  at_home: 'Maison',
  left_home: 'Sorti',
  at_friend: 'Chez ami',
} as const;

/** Parent availability: "Occupée" and "Indisponible" were merged into `busy`. */
export const availabilityColor = {
  available: '#0B8F55',
  busy: '#C2410C',
  on_my_way: '#B7791F',
} as const;

export const availabilityLabel = {
  available: 'Disponible',
  busy: 'Occupé·e',
  on_my_way: 'En route',
} as const;

/**
 * "En route" countdown from when the parent set it, in 5-minute steps so a child never sees
 * it race: 25 min → 20 min → … → 5 min → Presque là. Null when no ETA was given.
 */
export function etaLabel(etaMinutes: number | null, setAt: string | null, now = Date.now()): string | null {
  if (!etaMinutes) return null;
  const elapsed = setAt ? Math.max(0, (now - Date.parse(setAt)) / 60_000) : 0;
  const left = etaMinutes - elapsed;
  return left <= 0 ? 'Presque là' : `${Math.ceil(left / 5) * 5} min`;
}

/** The 8 colours a parent can pick for a child profile (also the drawing palette). */
export const childPalette = [
  '#E8484F',
  '#FF8A3D',
  '#FFC933',
  '#3DBE7A',
  '#3B9BF0',
  '#8B5CF6',
  '#F472B6',
  '#2A1B4D',
] as const;

/** Gremlin mascot avatars: `avatar_key` on a child profile -> body colour. */
export const gremlinAvatars = {
  'gremlin-pink': '#F472B6',
  'gremlin-blue': '#3B9BF0',
  'gremlin-orange': '#FF8A3D',
  'gremlin-red': '#E8484F',
  'gremlin-yellow': '#FFC933',
  'gremlin-green': '#3DBE7A',
  'gremlin-purple': '#8B5CF6',
  'gremlin-night': '#2A1B4D',
} as const;
export type GremlinAvatar = keyof typeof gremlinAvatars;

/** Sticker codes bundled in both apps (server catalogue: pack "swag"). */
export const swagStickers = ['swag/star', 'swag/heart', 'swag/sun', 'swag/ok', 'swag/pizza'] as const;

/** 4-point spacing scale, in dp / px. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 16, lg: 24, xl: 28, xxl: 40, pill: 999 } as const;

/** Soft shadow used on cards (CSS form; React Native uses `elevation`/`shadow*`). */
export const shadow = {
  card: '0 4px 16px rgba(42,27,77,.09)',
  raised: '0 6px 20px rgba(42,27,77,.12)',
} as const;

/** Minimum tap target on the child tablet (dp), per the architecture doc. */
export const childTapTarget = 64;
/** Minimum tap target on the parent phone (dp). */
export const parentTapTarget = 44;

/** Fredoka for titles and buttons, Nunito for body text. */
export const font = {
  display: 'Fredoka',
  body: 'Nunito',
  /** Kept for code written against the Sprint 0 placeholders. */
  family: 'Nunito',
  size: { caption: 13, body: 16, bodyLarge: 18, h3: 18, h2: 22, h1: 28, display: 40, childButton: 26 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
} as const;

/** Text styles from the Figma file (size / line height in px). */
export const textStyle = {
  displayKid: { family: 'Fredoka', weight: '600', size: 40, lineHeight: 48 },
  h1: { family: 'Fredoka', weight: '600', size: 28, lineHeight: 34 },
  h2: { family: 'Fredoka', weight: '500', size: 22, lineHeight: 28 },
  h3: { family: 'Fredoka', weight: '500', size: 18, lineHeight: 24 },
  bodyLarge: { family: 'Nunito', weight: '600', size: 18, lineHeight: 26 },
  body: { family: 'Nunito', weight: '400', size: 16, lineHeight: 22 },
  bodyStrong: { family: 'Nunito', weight: '700', size: 16, lineHeight: 22 },
  caption: { family: 'Nunito', weight: '600', size: 13, lineHeight: 18 },
  button: { family: 'Fredoka', weight: '500', size: 18, lineHeight: 24 },
  kidButton: { family: 'Fredoka', weight: '600', size: 26, lineHeight: 32 },
} as const;
export * from './art';
