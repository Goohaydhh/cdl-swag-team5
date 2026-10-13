import { AVATAR_VIEWBOX, renderAvatar } from '@swag/avatar';
import type { AvatarSpec } from '@swag/protocol';
import { createElement, memo } from 'react';
import { Gremlin, Initial } from './art';
import { kidColor } from './colors';

/** A custom avatar ("Créer mon avatar"), drawn from its choices. `zoom` crops to a part. */
export const AvatarPic = memo(function AvatarPic({ spec, size, zoom }: { spec: AvatarSpec; size: number; zoom?: string }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'inline-block', flex: 'none' }}>
      <svg width={size} height={size} viewBox={zoom ?? AVATAR_VIEWBOX} aria-hidden="true" style={{ display: 'block' }}>
        {renderAvatar(spec).map((s, i) => createElement(s.el, { key: i, ...s.props }))}
      </svg>
    </span>
  );
});

type KidLike = { avatar_key: string; color: string; avatar_spec?: AvatarSpec | null };

/** A child's picture: their custom avatar, or their Gremlin. */
export function KidPic({ kid, size }: { kid: KidLike; size: number }) {
  return kid.avatar_spec ? <AvatarPic spec={kid.avatar_spec} size={size} /> : <Gremlin color={kidColor(kid)} size={size} />;
}

/** A parent's picture: their custom avatar, or their round initial. */
export function ParentPic({ parent, color, size = 56 }: { parent: { display_name: string; avatar_spec?: AvatarSpec | null }; color: string; size?: number }) {
  return parent.avatar_spec ? <AvatarPic spec={parent.avatar_spec} size={size} /> : <Initial name={parent.display_name} color={color} size={size} />;
}

/** Overlapping pictures for a shared message. */
export function KidStack({ kids, size }: { kids: KidLike[]; size: number }) {
  return (
    <span style={{ display: 'inline-flex', flex: 'none' }}>
      {kids.map((k, i) => (
        <span
          key={i}
          style={{ marginLeft: i ? -Math.round(size * 0.35) : 0, display: 'inline-flex', borderRadius: '50%', boxShadow: '0 0 0 2px var(--a-bg)' }}
        >
          <KidPic kid={k} size={size} />
        </span>
      ))}
    </span>
  );
}
