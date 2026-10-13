import { AVATAR_VIEWBOX, type AvatarShape, renderAvatar } from '@swag/avatar';
import type { AvatarSpec } from '@swag/protocol';
import { type ComponentType, createElement, memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { Gremlin, kidColor } from './art';
import { Initial } from './kit';

const ELEMENTS = { path: Path, circle: Circle, ellipse: Ellipse, rect: Rect } as const;

// The shapes' props (d, cx, fill, strokeWidth...) are valid on the matching react-native-svg element.
const Shape = ({ s }: { s: AvatarShape }) => createElement(ELEMENTS[s.el] as ComponentType<object>, s.props);

/** A custom avatar ("Créer mon avatar"), drawn from its choices. `zoom` crops to a part. */
export const AvatarPic = memo(function AvatarPic({ spec, size, zoom }: { spec: AvatarSpec; size: number; zoom?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={zoom ?? AVATAR_VIEWBOX}>
        {renderAvatar(spec).map((s, i) => (
          <Shape key={i} s={s} />
        ))}
      </Svg>
    </View>
  );
});

type KidLike = { avatar_key: string; color: string; avatar_spec?: AvatarSpec | null };

/** A child's picture: their custom avatar, or their Gremlin. */
export function KidPic({ kid, size }: { kid: KidLike; size: number }) {
  return kid.avatar_spec ? <AvatarPic spec={kid.avatar_spec} size={size} /> : <Gremlin color={kidColor(kid)} size={size} />;
}

/** A parent's picture: their custom avatar, or their round initial. */
export function ParentPic({ parent, color, size = 44 }: { parent: { display_name: string; avatar_spec?: AvatarSpec | null }; color: string; size?: number }) {
  return parent.avatar_spec ? <AvatarPic spec={parent.avatar_spec} size={size} /> : <Initial name={parent.display_name} color={color} size={size} />;
}

/** Overlapping pictures for a shared message. */
export function KidStack({ kids, size }: { kids: KidLike[]; size: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {kids.map((k, i) => (
        <View key={i} style={{ marginLeft: i ? -Math.round(size * 0.35) : 0 }}>
          <KidPic kid={k} size={size} />
        </View>
      ))}
    </View>
  );
}
