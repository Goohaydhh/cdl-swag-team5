import { speakerLabel } from '@swag/client';
import type { Kid } from '../lib/useTablet';
import { Gremlin, Icon } from './art';
import { kidColor } from './colors';

/**
 * "Qui parle ?": horizontal checkable chips. Several checked = a shared message (message
 * commun), one checked = that child's own message. At least one stays checked.
 */
export function WhoChips({ kids, who, onChange }: { kids: Kid[]; who: string[]; onChange: (ids: string[]) => void }) {
  if (kids.length <= 1) return null;
  const toggle = (id: string) => {
    const on = who.includes(id);
    if (on && who.length === 1) return;
    onChange(on ? who.filter((w) => w !== id) : kids.filter((k) => k.id === id || who.includes(k.id)).map((k) => k.id));
  };
  const names = kids.filter((k) => who.includes(k.id)).map((k) => k.display_name);
  return (
    <div className="row" role="group" aria-label="Qui parle ?" style={{ gap: 10, flex: 'none' }}>
      {kids.map((k) => {
        const on = who.includes(k.id);
        return (
          <button key={k.id} className="whochip" aria-pressed={on} onClick={() => toggle(k.id)}>
            <Gremlin color={kidColor(k)} size={44} />
            <span>{k.display_name}</span>
            <span className="wbox">{on && <Icon name="check" size={20} color="#fff" stroke={3.4} />}</span>
          </button>
        );
      })}
      <span className="whomode" style={{ marginLeft: 6 }}>
        {who.length > 1 ? (
          <>
            <Icon name="users" size={24} stroke={2.4} />
            Message commun
          </>
        ) : (
          `Message de ${speakerLabel(names)}`
        )}
      </span>
    </div>
  );
}
