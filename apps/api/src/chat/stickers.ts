/**
 * Built-in sticker catalogue. The apps bundle the images under the same codes, so stickers
 * work offline and never touch a third party. The design developers own the artwork.
 */
export const STICKER_PACKS = [
  {
    id: 'feelings',
    title: 'Feelings',
    stickers: ['happy', 'love', 'laugh', 'sad', 'angry', 'sleepy', 'wow', 'thinking'],
  },
  {
    id: 'home',
    title: 'Home',
    stickers: ['house', 'key', 'snack', 'homework', 'tv', 'bed', 'bath', 'dinner'],
  },
  {
    id: 'animals',
    title: 'Animals',
    stickers: ['cat', 'dog', 'fox', 'panda', 'unicorn', 'dino', 'owl', 'bunny'],
  },
] as const;

const CODES = new Set<string>(STICKER_PACKS.flatMap((p) => p.stickers.map((s) => `${p.id}/${s}`)));

export const isStickerCode = (code: string) => CODES.has(code);

export const stickerCatalog = () =>
  STICKER_PACKS.map((p) => ({
    id: p.id,
    title: p.title,
    stickers: p.stickers.map((s) => ({ code: `${p.id}/${s}` })),
  }));
