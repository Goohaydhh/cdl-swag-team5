import { availabilityColor, availabilityLabel, statusChildLabel, statusColor } from '@swag/design-tokens';
import { speakerLabel } from '@swag/client';
import type { ChildStatus } from '@swag/protocol';
import type { Tablet } from '../lib/useTablet';
import { GremlinStack, Icon, type IconName, Initial } from '../ui/art';
import { kidColor, PARENT_COLORS } from '../ui/colors';
import { WhoChips } from '../ui/WhoChips';

const TILES: { status: ChildStatus; icon: IconName }[] = [
  { status: 'at_home', icon: 'house' },
  { status: 'left_home', icon: 'door' },
  { status: 'at_friend', icon: 'users' },
];

/** K4/K5 "Mon statut": who is speaking, the parents' availability, three big status tiles. */
export function StatusScreen({ t }: { t: Tablet }) {
  const speaking = t.kids.filter((k) => t.who.includes(k.id));
  const names = speaking.length >= 3 ? 'les enfants' : speakerLabel(speaking.map((k) => k.display_name));
  const parentNames = speakerLabel(t.parents.map((p) => p.display_name)) || 'tes parents';

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
                <Initial name={p.display_name} color={PARENT_COLORS[i % PARENT_COLORS.length]!} />
                <div>
                  <div className="h3">{p.display_name}</div>
                  <div className="cap row" style={{ gap: 6 }}>
                    <i style={{ width: 12, height: 12, borderRadius: '50%', background: availabilityColor[p.availability] }} />
                    {availabilityLabel[p.availability]}
                    {p.availability === 'on_my_way' && p.eta_minutes ? ` · ${p.eta_minutes} min` : ''}
                  </div>
                </div>
                {p.ringer === 'silent' && (
                  <span className="pill" style={{ width: 40, height: 40, background: 'var(--a-bg)', display: 'grid', placeItems: 'center' }} title="Téléphone en silencieux">
                    <Icon name="bellOff" size={22} color="var(--a-soft)" />
                  </span>
                )}
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
              {isOn ? (
                <span className="sent">
                  <Icon name={t.outboxSize ? 'clock' : 'check'} size={24} color={t.outboxSize ? 'var(--a-soft)' : 'var(--a-home)'} stroke={3.2} />
                  {t.outboxSize ? 'Pas encore envoyé' : `Envoyé à ${parentNames}`}
                </span>
              ) : (
                <span style={{ height: 48 }} />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
