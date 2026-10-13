import type { AvatarSpec } from '@swag/protocol';
import { BACKGROUND, CLOTHES, HAIR, SKIN } from './palette';

type Key = Exclude<keyof AvatarSpec, 'v'>;

export interface AvatarOption {
  value: string;
  label: string;
  /** Swatch colour for colour parts; thumbnails are drawn for the others. */
  color?: string;
}

export interface AvatarCategory {
  key: Key;
  label: string;
  kind: 'thumb' | 'swatch';
  /** Part of the 200 x 200 drawing to zoom on in thumbnails (eyes, mouth...). */
  zoom?: string;
  /** Only offered in the parent app. */
  parentOnly?: boolean;
  options: AvatarOption[];
}

const FACE_ZOOM = '45 60 110 80';
const swatches = <K extends string>(palette: Record<K, string>, labels: Record<K, string>): AvatarOption[] =>
  (Object.keys(palette) as K[]).map((value) => ({ value, label: labels[value], color: palette[value] }));

/** The avatar maker's tabs, in order, with French labels for both apps. */
export const AVATAR_CATEGORIES: AvatarCategory[] = [
  {
    key: 'skin',
    label: 'Peau',
    kind: 'swatch',
    options: swatches(SKIN, { s1: 'Très claire', s2: 'Claire', s3: 'Mate', s4: 'Hâlée', s5: 'Foncée', s6: 'Très foncée' }),
  },
  {
    key: 'face',
    label: 'Visage',
    kind: 'thumb',
    options: [
      { value: 'round', label: 'Rond' },
      { value: 'oval', label: 'Ovale' },
      { value: 'square', label: 'Carré' },
    ],
  },
  {
    key: 'hair_style',
    label: 'Coiffure',
    kind: 'thumb',
    options: [
      { value: 'short', label: 'Courts' },
      { value: 'buzz', label: 'Très courts' },
      { value: 'curly', label: 'Bouclés' },
      { value: 'long', label: 'Longs' },
      { value: 'bun', label: 'Chignon' },
      { value: 'braids', label: 'Tresses' },
      { value: 'headscarf', label: 'Foulard' },
      { value: 'none', label: 'Sans cheveux' },
    ],
  },
  {
    key: 'hair_color',
    label: 'Couleur des cheveux',
    kind: 'swatch',
    options: swatches(HAIR, {
      black: 'Noirs',
      brown: 'Bruns',
      auburn: 'Roux',
      blond: 'Blonds',
      grey: 'Gris',
      purple: 'Violets',
      pink: 'Roses',
    }),
  },
  {
    key: 'eyes',
    label: 'Yeux',
    kind: 'thumb',
    zoom: FACE_ZOOM,
    options: [
      { value: 'round', label: 'Ronds' },
      { value: 'happy', label: 'Joyeux' },
      { value: 'almond', label: 'En amande' },
      { value: 'big', label: 'Grands' },
    ],
  },
  {
    key: 'brows',
    label: 'Sourcils',
    kind: 'thumb',
    zoom: FACE_ZOOM,
    options: [
      { value: 'soft', label: 'Doux' },
      { value: 'straight', label: 'Droits' },
      { value: 'raised', label: 'Levés' },
    ],
  },
  {
    key: 'mouth',
    label: 'Bouche',
    kind: 'thumb',
    zoom: FACE_ZOOM,
    options: [
      { value: 'smile', label: 'Sourire' },
      { value: 'grin', label: 'Grand sourire' },
      { value: 'calm', label: 'Calme' },
      { value: 'open', label: 'Surpris' },
    ],
  },
  {
    key: 'glasses',
    label: 'Lunettes',
    kind: 'thumb',
    zoom: FACE_ZOOM,
    options: [
      { value: 'none', label: 'Sans lunettes' },
      { value: 'round', label: 'Rondes' },
      { value: 'square', label: 'Carrées' },
    ],
  },
  {
    key: 'facial_hair',
    label: 'Barbe',
    kind: 'thumb',
    zoom: FACE_ZOOM,
    parentOnly: true,
    options: [
      { value: 'none', label: 'Sans' },
      { value: 'mustache', label: 'Moustache' },
      { value: 'beard', label: 'Barbe' },
    ],
  },
  {
    key: 'outfit',
    label: 'Tenue',
    kind: 'thumb',
    options: [
      { value: 'tshirt', label: 'T-shirt' },
      { value: 'hoodie', label: 'Sweat à capuche' },
      { value: 'sweater', label: 'Pull' },
      { value: 'shirt', label: 'Chemise' },
      { value: 'dungarees', label: 'Salopette' },
    ],
  },
  {
    key: 'outfit_color',
    label: 'Couleur de la tenue',
    kind: 'swatch',
    options: swatches(CLOTHES, {
      purple: 'Violet',
      green: 'Vert',
      orange: 'Orange',
      blue: 'Bleu',
      yellow: 'Jaune',
      pink: 'Rose',
      red: 'Rouge',
      grey: 'Gris',
    }),
  },
  {
    key: 'background',
    label: 'Fond',
    kind: 'swatch',
    options: swatches(BACKGROUND, { lavender: 'Lavande', mint: 'Menthe', peach: 'Pêche', sky: 'Ciel', sun: 'Soleil', rose: 'Rose' }),
  },
];

/** The same avatar with one part changed (used for live thumbnails). */
export const withPart = (spec: AvatarSpec, key: Key, value: string): AvatarSpec => ({ ...spec, [key]: value }) as AvatarSpec;
