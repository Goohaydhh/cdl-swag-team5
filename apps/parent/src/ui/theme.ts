import { color, radius } from '@swag/design-tokens';
import { StyleSheet } from 'react-native';

/** Font family names registered in App.tsx with expo-font. */
export const F = {
  d500: 'Fredoka_500Medium',
  d600: 'Fredoka_600SemiBold',
  b400: 'Nunito_400Regular',
  b600: 'Nunito_600SemiBold',
  b700: 'Nunito_700Bold',
} as const;

export const C = color;

export const shadowCard = {
  shadowColor: '#2A1B4D',
  shadowOpacity: 0.09,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  page: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  card: { backgroundColor: C.surface, borderRadius: radius.xl, ...shadowCard },
  h1: { fontFamily: F.d600, fontSize: 28, lineHeight: 34, color: C.ink },
  h2: { fontFamily: F.d500, fontSize: 22, lineHeight: 28, color: C.ink },
  h3: { fontFamily: F.d500, fontSize: 18, lineHeight: 24, color: C.ink },
  body: { fontFamily: F.b400, fontSize: 16, lineHeight: 22, color: C.ink },
  strong: { fontFamily: F.b700, fontSize: 16, lineHeight: 22, color: C.ink },
  cap: { fontFamily: F.b600, fontSize: 13, lineHeight: 18, color: C.inkSoft },
  field: {
    height: 48,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.border,
    paddingHorizontal: 14,
    fontFamily: F.b600,
    fontSize: 16,
    color: C.ink,
  },
  error: { fontFamily: F.b700, fontSize: 14, color: C.danger },
});
