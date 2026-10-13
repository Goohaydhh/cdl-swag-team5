import { radius } from '@swag/design-tokens';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, Text, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './art';
import { C, F, s } from './theme';

type Variant = 'primary' | 'soft' | 'white' | 'line';

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  busy,
  style,
  height = 56,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  height?: number;
}) {
  const bg = { primary: C.primary, soft: C.primarySoft, white: C.surface, line: 'transparent' }[variant];
  const fg = { primary: '#fff', soft: C.primaryDeep, white: C.ink, line: C.primary }[variant];
  const border = variant === 'white' ? C.border : variant === 'line' ? C.primary : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: height < 50 ? 12 : 20,
          borderRadius: radius.pill,
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={22} color={fg} stroke={2.4} /> : null}
      <Text numberOfLines={1} style={{ fontFamily: F.d500, fontSize: height < 50 ? 16 : 18, color: fg, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/** Round initial for a parent. */
export function Initial({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.d500, fontSize: size / 2, color: '#fff' }}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}
export const PARENT_COLORS = ['#6B4EFF', '#3DBE7A', '#FF8A3D', '#3B9BF0'];

export function Checkbox({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? C.primary : C.surface,
        borderWidth: on ? 0 : 2,
        borderColor: C.border,
      }}
    >
      {on && <Icon name="check" size={16} color="#fff" stroke={3} />}
    </View>
  );
}

export function TopBar({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={[s.row, { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, backgroundColor: C.surface }]}>
      {onBack && (
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={onBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="left" size={24} />
        </Pressable>
      )}
      <View style={s.grow}>
        <Text style={s.h3}>{title}</Text>
        {subtitle ? <Text style={s.cap}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
