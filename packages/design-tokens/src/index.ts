// Placeholder values for Sprint 0. The design developers own these and replace them from Figma.

export const color = {
  background: '#FFFBF5',
  surface: '#FFFFFF',
  textPrimary: '#1F2430',
  textSecondary: '#5B6170',
  border: '#E3E0DA',
  primary: '#3D5AFE',
  danger: '#D32F2F',
} as const;

/** One colour per child status, used on the tablet buttons and the parent widget. */
export const statusColor = {
  at_home: '#2E7D32',
  left_home: '#EF6C00',
  at_friend: '#6A1B9A',
} as const;

/** Colours a parent can pick for a child profile. */
export const childPalette = [
  '#FF7043',
  '#42A5F5',
  '#66BB6A',
  '#AB47BC',
  '#FFCA28',
  '#26C6DA',
  '#EC407A',
  '#8D6E63',
] as const;

/** 4-point spacing scale, in dp / px. */
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 16, lg: 24, pill: 999 } as const;

/** Minimum tap target on the child tablet (dp), per the architecture doc. */
export const childTapTarget = 64;

export const font = {
  family: 'Nunito',
  size: { caption: 13, body: 16, title: 22, display: 32, childButton: 28 },
  weight: { regular: '400', semibold: '600', bold: '700' },
} as const;
