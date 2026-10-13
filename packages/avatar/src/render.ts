import type { AvatarSpec } from '@swag/protocol';
import { BACKGROUND, CLOTHES, HAIR, INK, SKIN, shade } from './palette';

/**
 * One SVG element. Props use React's camelCase names, which both react-dom and
 * react-native-svg accept, so each app maps `el` to its own component and spreads `props`.
 */
export interface AvatarShape {
  el: 'path' | 'circle' | 'ellipse' | 'rect';
  props: Record<string, string | number>;
}

/** Everything is drawn in a 200 x 200 box; apps clip it to a circle. */
export const AVATAR_VIEWBOX = '0 0 200 200';

const path = (d: string, props: Record<string, string | number> = {}): AvatarShape => ({ el: 'path', props: { d, ...props } });
const line = (d: string, stroke: string, strokeWidth: number): AvatarShape =>
  path(d, { fill: 'none', stroke, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' });
const circle = (cx: number, cy: number, r: number, fill: string, extra: Record<string, string | number> = {}): AvatarShape => ({
  el: 'circle',
  props: { cx, cy, r, fill, ...extra },
});
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, extra: Record<string, string | number> = {}): AvatarShape => ({
  el: 'ellipse',
  props: { cx, cy, rx, ry, fill, ...extra },
});

/** Head geometry for each face shape: half width, top and bottom (chin). */
const FACES: Record<AvatarSpec['face'], { hw: number; top: number; bottom: number }> = {
  round: { hw: 44, top: 46, bottom: 140 },
  oval: { hw: 40, top: 42, bottom: 144 },
  square: { hw: 42, top: 46, bottom: 142 },
};

const SHOULDERS = 'M28 200 C28 170 56 154 100 154 C144 154 172 170 172 200 Z';
const EYE_Y = 96;

/** Turns an avatar into SVG shapes, back to front. */
export function renderAvatar(spec: AvatarSpec): AvatarShape[] {
  const skin = SKIN[spec.skin];
  const hair = HAIR[spec.hair_color];
  const cloth = CLOTHES[spec.outfit_color];
  const f = FACES[spec.face];
  const L = 100 - f.hw;
  const R = 100 + f.hw;
  const T = f.top;
  const B = f.bottom;
  const cy = (T + B) / 2;
  const scarf = spec.hair_style === 'headscarf';
  const out: AvatarShape[] = [{ el: 'rect', props: { x: 0, y: 0, width: 200, height: 200, fill: BACKGROUND[spec.background] } }];

  // Hair that falls behind the head.
  if (spec.hair_style === 'long') {
    out.push(path(`M${L - 6} 96 C${L - 8} ${T} 74 ${T - 14} 100 ${T - 14} C126 ${T - 14} ${R + 8} ${T} ${R + 6} 96 L156 170 Q100 186 44 170 Z`, { fill: hair }));
  } else if (spec.hair_style === 'curly') {
    out.push(ellipse(100, cy - 8, f.hw + 12, (B - T) / 2 + 2, hair));
  } else if (spec.hair_style === 'bun') {
    out.push(circle(100, T - 12, 17, hair));
  }

  // Neck and outfit.
  if (!scarf) {
    out.push({ el: 'rect', props: { x: 86, y: B - 16, width: 28, height: 44, fill: skin } });
    out.push({ el: 'rect', props: { x: 86, y: B - 6, width: 28, height: 10, fill: shade(skin, 0.14) } });
  }
  out.push(...outfit(spec.outfit, cloth, skin, scarf));

  if (scarf) {
    out.push(
      path(`M${L - 8} 104 C${L - 10} 50 70 ${T - 18} 100 ${T - 18} C130 ${T - 18} ${R + 10} 50 ${R + 8} 104 C${R + 8} 132 146 150 138 162 Q100 180 62 162 C54 150 ${L - 8} 132 ${L - 8} 104 Z`, {
        fill: shade(cloth, -0.25),
      }),
    );
  } else {
    // Ears.
    for (const x of [L + 1, R - 1]) {
      out.push(circle(x, 98, 9, skin), circle(x, 98, 4, shade(skin, 0.12)));
    }
  }

  // Face, cheeks, nose.
  out.push(
    spec.face === 'square'
      ? { el: 'rect', props: { x: L, y: T, width: f.hw * 2, height: B - T, rx: 30, fill: skin } }
      : ellipse(100, cy, f.hw, (B - T) / 2, skin),
  );
  out.push(circle(72, 112, 7, '#FF8FA3', { opacity: 0.3 }), circle(128, 112, 7, '#FF8FA3', { opacity: 0.3 }));
  out.push(line('M100 101 Q105 108 99 110', shade(skin, 0.25), 3));

  // Beard and mustache sit under the mouth line.
  if (spec.facial_hair === 'beard') {
    out.push(path(`M${L + 2} 100 C${L + 4} ${B + 2} 80 ${B + 6} 100 ${B + 6} C120 ${B + 6} ${R - 4} ${B + 2} ${R - 2} 100 C${R - 6} 126 118 130 100 128 C82 130 ${L + 6} 126 ${L + 2} 100 Z`, { fill: hair }));
  }
  if (spec.facial_hair !== 'none') {
    out.push(path('M86 113 Q93 106 100 111 Q107 106 114 113 Q107 117 100 114 Q93 117 86 113 Z', { fill: hair }));
  }

  out.push(...mouth(spec.mouth));
  out.push(...eyes(spec.eyes));

  const browColor = spec.hair_style === 'none' || spec.hair_style === 'headscarf' ? shade(skin, 0.45) : shade(hair, 0.1);
  out.push(...brows(spec.brows, browColor));

  out.push(...hairFront(spec.hair_style, hair, cloth, L, R, T, cy, (B - T) / 2));

  if (scarf) {
    out.push(line(`M${L - 2} 108 C${L - 4} ${T - 2} 70 ${T - 12} 100 ${T - 12} C130 ${T - 12} ${R + 4} ${T - 2} ${R + 2} 108`, shade(cloth, -0.05), 12));
  }

  out.push(...glasses(spec.glasses, L, R));
  return out;
}

function outfit(style: AvatarSpec['outfit'], c: string, skin: string, scarf: boolean): AvatarShape[] {
  const dark = shade(c, 0.22);
  // The skin showing inside the collar (hidden under a headscarf).
  const collarSkin = (d: string) => (scarf ? [] : [path(d, { fill: skin })]);
  switch (style) {
    case 'tshirt':
      return [path(SHOULDERS, { fill: c }), ...collarSkin('M84 154 Q100 172 116 154 Z'), line('M84 155 Q100 172 116 155', dark, 5)];
    case 'sweater':
      return [path(SHOULDERS, { fill: c }), ...collarSkin('M86 154 Q100 166 114 154 Z'), line('M84 155 Q100 170 116 155', dark, 8)];
    case 'hoodie':
      return [
        path(SHOULDERS, { fill: c }),
        path('M66 160 C70 146 84 140 100 140 C116 140 130 146 134 160 C124 170 112 174 100 174 C88 174 76 170 66 160 Z', { fill: dark }),
        ...collarSkin('M88 148 Q100 168 112 148 Z'),
        line('M93 170 L91 188', shade(c, -0.7), 3),
        line('M107 170 L109 188', shade(c, -0.7), 3),
        circle(91, 189, 2.5, shade(c, -0.7)),
        circle(109, 189, 2.5, shade(c, -0.7)),
      ];
    case 'shirt':
      return [
        path(SHOULDERS, { fill: c }),
        ...collarSkin('M88 154 L100 172 L112 154 Z'),
        path('M86 152 L100 172 L90 178 L78 160 Z', { fill: '#FFFFFF', stroke: shade(c, 0.1), strokeWidth: 1.5, strokeLinejoin: 'round' }),
        path('M114 152 L100 172 L110 178 L122 160 Z', { fill: '#FFFFFF', stroke: shade(c, 0.1), strokeWidth: 1.5, strokeLinejoin: 'round' }),
        circle(100, 184, 2.2, dark),
        circle(100, 195, 2.2, dark),
      ];
    case 'dungarees':
      return [
        path(SHOULDERS, { fill: '#F4F1FA' }),
        ...collarSkin('M86 154 Q100 166 114 154 Z'),
        line('M84 155 Q100 168 116 155', '#DDD6EE', 4),
        { el: 'rect', props: { x: 74, y: 176, width: 52, height: 30, rx: 6, fill: c } },
        line('M62 162 L76 180', c, 7),
        line('M138 162 L124 180', c, 7),
        circle(77, 180, 3, dark),
        circle(123, 180, 3, dark),
      ];
  }
}

function mouth(m: AvatarSpec['mouth']): AvatarShape[] {
  switch (m) {
    case 'smile':
      return [line('M88 117 Q100 129 112 117', INK, 3.5)];
    case 'grin':
      return [path('M86 115 Q100 134 114 115 Z', { fill: INK }), path('M89 116 L111 116 L109 120 Q100 122 91 120 Z', { fill: '#FFFFFF' })];
    case 'calm':
      return [line('M92 120 Q100 123 108 120', INK, 3.5)];
    case 'open':
      return [ellipse(100, 121, 6, 7, INK), ellipse(100, 124, 4, 3, '#FF8FA3')];
  }
}

function eyes(e: AvatarSpec['eyes']): AvatarShape[] {
  const out: AvatarShape[] = [];
  for (const x of [84, 116]) {
    switch (e) {
      case 'round':
        out.push(circle(x, EYE_Y, 6, INK), circle(x + 2, EYE_Y - 2, 2, '#FFFFFF'));
        break;
      case 'happy':
        out.push(line(`M${x - 7} ${EYE_Y + 2} Q${x} ${EYE_Y - 6} ${x + 7} ${EYE_Y + 2}`, INK, 3.5));
        break;
      case 'almond':
        out.push(ellipse(x, EYE_Y, 7, 4.5, INK), circle(x + 2, EYE_Y - 1.5, 1.8, '#FFFFFF'));
        break;
      case 'big':
        out.push(
          ellipse(x, EYE_Y, 8.5, 9.5, '#FFFFFF', { stroke: INK, strokeWidth: 1.5 }),
          circle(x, EYE_Y + 1, 5.5, INK),
          circle(x + 2, EYE_Y - 1, 2, '#FFFFFF'),
        );
        break;
    }
  }
  return out;
}

function brows(b: AvatarSpec['brows'], color: string): AvatarShape[] {
  switch (b) {
    case 'soft':
      return [line('M76 82 Q84 76 92 81', color, 4), line('M108 81 Q116 76 124 82', color, 4)];
    case 'straight':
      return [line('M76 80 L92 80', color, 4), line('M108 80 L124 80', color, 4)];
    case 'raised':
      return [line('M76 80 Q84 72 92 78', color, 4), line('M108 78 Q116 72 124 80', color, 4)];
  }
}

function hairFront(
  style: AvatarSpec['hair_style'],
  hair: string,
  cloth: string,
  L: number,
  R: number,
  T: number,
  cy: number,
  ry: number,
): AvatarShape[] {
  // A full fringe with sideburns down to the temples.
  const cap = (sides: number) =>
    path(`M${L - 2} ${sides} C${L - 6} ${T + 4} 70 ${T - 8} 100 ${T - 8} C130 ${T - 8} ${R + 6} ${T + 4} ${R + 2} ${sides} C${R - 4} ${T + 30} 128 ${T + 22} 100 ${T + 24} C78 ${T + 26} ${L + 8} ${T + 28} ${L - 2} ${sides} Z`, {
      fill: hair,
    });

  switch (style) {
    case 'short':
      return [cap(100)];
    case 'buzz':
      return [
        path(`M${L} 88 C${L - 2} ${T + 6} 72 ${T - 3} 100 ${T - 3} C128 ${T - 3} ${R + 2} ${T + 6} ${R} 88 C${R - 4} ${T + 20} 126 ${T + 12} 100 ${T + 12} C74 ${T + 12} ${L + 4} ${T + 20} ${L} 88 Z`, {
          fill: hair,
          opacity: 0.9,
        }),
      ];
    case 'curly': {
      const out: AvatarShape[] = [cap(92)];
      for (let k = 0; k <= 10; k++) {
        const a = ((190 + k * 16) * Math.PI) / 180;
        out.push(circle(Math.round(100 + (R - 100 + 4) * Math.cos(a)), Math.round(cy - 6 + (ry + 4) * Math.sin(a)), 13, hair));
      }
      return out;
    }
    case 'long':
      return [
        path(`M${L - 2} 112 C${L - 6} ${T + 2} 72 ${T - 8} 100 ${T - 8} C128 ${T - 8} ${R + 6} ${T + 2} ${R + 2} 112 C${R - 2} ${T + 34} 120 ${T + 20} 106 ${T + 16} C98 ${T + 30} 78 ${T + 32} ${L - 2} 112 Z`, {
          fill: hair,
        }),
      ];
    case 'bun':
      return [cap(88)];
    case 'braids': {
      const out: AvatarShape[] = [cap(92)];
      // Hanging just outside the cheeks, down onto the shoulders.
      for (const x of [L - 5, R + 5]) {
        for (let y = 100; y <= 172; y += 12) out.push(circle(x, y, 7.5, hair, { stroke: shade(hair, 0.2), strokeWidth: 1.5 }));
        out.push(circle(x, 182, 4.5, cloth));
      }
      return out;
    }
    case 'headscarf':
    case 'none':
      return [];
  }
}

function glasses(g: AvatarSpec['glasses'], L: number, R: number): AvatarShape[] {
  if (g === 'none') return [];
  const frame = { fill: '#FFFFFF', fillOpacity: 0.18, stroke: INK, strokeWidth: 3 };
  const lenses: AvatarShape[] =
    g === 'round'
      ? [circle(84, EYE_Y, 12, '#FFFFFF', frame), circle(116, EYE_Y, 12, '#FFFFFF', frame)]
      : [
          { el: 'rect', props: { x: 71, y: EYE_Y - 10, width: 26, height: 20, rx: 5, ...frame } },
          { el: 'rect', props: { x: 103, y: EYE_Y - 10, width: 26, height: 20, rx: 5, ...frame } },
        ];
  return [...lenses, line('M96 95 Q100 92 104 95', INK, 3), line(`M${g === 'round' ? 72 : 71} 93 L${L} 91`, INK, 3), line(`M${g === 'round' ? 128 : 129} 93 L${R} 91`, INK, 3)];
}
