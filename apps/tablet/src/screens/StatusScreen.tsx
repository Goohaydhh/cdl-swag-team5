import { availabilityColor, availabilityLabel, etaLabel, statusChildLabel, statusColor } from '@swag/design-tokens';
import { speakerLabel } from '@swag/client';
import type { ChildStatus, RingerMode } from '@swag/protocol';
import { useEffect, useState } from 'react';
import type { Tablet } from '../lib/useTablet';
import { GremlinStack, Icon, type IconName, Initial } from '../ui/art';
import { kidColor, parentColor } from '../ui/colors';
import { WhoChips } from '../ui/WhoChips';

const TILES: { status: ChildStatus; icon: IconName }[] = [
  { status: 'at_home', icon: 'house' },
  { status: 'left_home', icon: 'door' },
  { status: 'at_friend', icon: 'users' },
];

/** The current time, refreshed every 30 s while an "En route" countdown is on screen. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}

/** K4/K5 "Mon statut": who is speaking, the parents' availability, three big status tiles. */
export function StatusScreen({ t }: { t: Tablet }) {
  const speaking = t.kids.filter((k) => t.who.includes(k.id));
  const names = speaking.length >= 3 ? 'les enfants' : speakerLabel(speaking.map((k) => k.display_name));
  const now = useNow(t.parents.some((p) => p.availability === 'on_my_way' && !!p.eta_minutes));

  return (
    <>
      {t.kids.length > 1 && (
        <div className="row" style={{ padding: '6px 48px 0', gap: 16, flex: 'none' }}>
          <span className="h3" style={{ color: 'var(--a-soft)' }}>Qui parle ?</span>
          <WhoChips kids={t.kids} who={t.who} onChange={t.setWho} />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between', padding: '14px 48px 8px', flex: 'none' }}>
        <div className="row" style={{ gap: 16 }}>
          <GremlinStack colors={speaking.map(kidColor)} size={speaking.length > 1 ? 56 : 72} />
          <h1 className="big">Salut {names} !</h1>
        </div>
        {t.parents.length > 0 && (
          <div className="pres">
            {t.parents.map((p, i) => (
              <div className="row" key={p.id}>
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <Initial name={p.display_name} color={parentColor(p, i)} />
                  <RingerBadge mode={p.ringer} />
                </span>
                <div>
                  <div className="h3">{p.display_name}</div>
                  <div className="cap row" style={{ gap: 6 }}>
                    <i style={{ width: 12, height: 12, borderRadius: '50%', background: availabilityColor[p.availability] }} />
                    {availabilityLabel[p.availability]}
                    {p.availability === 'on_my_way' && p.eta_minutes ? ` · ${etaLabel(p.eta_minutes, p.availability_at, now)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tiles">
        {TILES.map(({ status, icon }) => {
          const isOn = speaking.length > 0 && speaking.every((k) => t.statuses[k.id]?.status === status);
          const col = statusColor[status];
          return (
            <button key={status} className="tile" aria-pressed={isOn} style={{ background: col }} onClick={() => t.sendStatus(status)}>
              <span className="ring">
                <Icon name={icon} size={84} color={col} />
              </span>
              {statusChildLabel[status]}
            </button>
          );
        })}
      </div>
    </>
  );
}

const RINGER_BADGE: Partial<Record<RingerMode, { icon: IconName; label: string }>> = {
  silent: { icon: 'bellOff', label: 'Téléphone en silencieux' },
  vibrate: { icon: 'vibrate', label: 'Téléphone en vibreur' },
};

/** FR-13: small badge on a parent's avatar when their phone won't ring. */
function RingerBadge({ mode }: { mode: RingerMode }) {
  const b = RINGER_BADGE[mode];
  if (!b) return null;
  return (
    <span
      role="img"
      aria-label={b.label}
      title={b.label}
      style={{ position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: '50%', background: 'var(--a-card)', border: '2px solid var(--a-bg)', display: 'grid', placeItems: 'center' }}
    >
      <Icon name={b.icon} size={16} color="var(--a-soft)" />
    </span>
  );
}
