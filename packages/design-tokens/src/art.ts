// SVG artwork from the SWAG designs, as plain strings so both apps can render it:
// the tablet with <img src={svgDataUri(...)}> / innerHTML, the parent with react-native-svg's <SvgXml>.

/** The Gremlin mascot, in the child's colour. viewBox 64 x 64. */
export function gremlinSvg(bodyColor: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">` +
    `<path d="M10 24 4 5l21 9z" fill="${bodyColor}"/><path d="M54 24 60 5 39 14z" fill="${bodyColor}"/>` +
    `<ellipse cx="32" cy="37" rx="25" ry="22" fill="${bodyColor}"/>` +
    `<circle cx="23" cy="33" r="7" fill="#fff"/><circle cx="41" cy="33" r="7" fill="#fff"/>` +
    `<circle cx="24.5" cy="34" r="3.4" fill="#2A1B4D"/><circle cx="42.5" cy="34" r="3.4" fill="#2A1B4D"/>` +
    `<path d="M22 46q10 9 20 0" stroke="#2A1B4D" stroke-width="3.2" stroke-linecap="round"/></svg>`
  );
}

const STICKER_BODY: Record<string, string> = {
  star:
    '<path d="M32 4l8.5 17.2 19 2.8-13.8 13.4 3.3 18.9L32 47.4 15 56.3l3.3-18.9L4.5 24l19-2.8z" fill="#FFC933" stroke="#2A1B4D" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="29" r="2.4" fill="#2A1B4D"/><circle cx="38" cy="29" r="2.4" fill="#2A1B4D"/><path d="M26 36q6 5 12 0" stroke="#2A1B4D" stroke-width="2.6" stroke-linecap="round"/>',
  heart:
    '<path d="M32 56S6 40 6 22a13 13 0 0 1 26-4 13 13 0 0 1 26 4c0 18-26 34-26 34z" fill="#E8484F" stroke="#2A1B4D" stroke-width="3" stroke-linejoin="round"/>',
  sun: '<circle cx="32" cy="32" r="14" fill="#FFC933" stroke="#2A1B4D" stroke-width="3"/><g stroke="#2A1B4D" stroke-width="3.5" stroke-linecap="round"><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.6 5.6M44.8 44.8l5.6 5.6M13.6 50.4l5.6-5.6M44.8 19.2l5.6-5.6"/></g>',
  ok: '<circle cx="32" cy="32" r="26" fill="#3DBE7A" stroke="#2A1B4D" stroke-width="3"/><path d="m20 33 8 8 16-18" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  pizza:
    '<path d="M8 14q24-12 48 0L32 58z" fill="#FFC933" stroke="#2A1B4D" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="26" r="4.5" fill="#E8484F"/><circle cx="38" cy="30" r="4.5" fill="#E8484F"/><circle cx="31" cy="42" r="4" fill="#E8484F"/>',
};

/**
 * A sticker by its server code (`swag/star`) or short name (`star`). Codes from the other
 * server packs have no artwork yet and fall back to the star. viewBox 64 x 64.
 */
export function stickerSvg(code: string): string {
  const name = code.includes('/') ? code.split('/')[1]! : code;
  const body = STICKER_BODY[name] ?? STICKER_BODY.star!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${body}</svg>`;
}

export const stickerNames = ['star', 'heart', 'sun', 'ok', 'pizza'] as const;

/** For <img src>: works in any browser and WebView. */
export const svgDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
