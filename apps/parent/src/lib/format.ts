/** "à l’instant", "il y a 12 min", "16:32", "hier 18:05" — as in the designs. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso);
  const diff = Math.max(0, now - t.getTime());
  const hhmm = t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60_000) return 'à l’instant';
  if (diff < 60 * 60_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  const today = new Date(now);
  if (t.toDateString() === today.toDateString()) return hhmm;
  const yesterday = new Date(now - 86_400_000);
  if (t.toDateString() === yesterday.toDateString()) return `hier ${hhmm}`;
  return t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function todayLabel(d = new Date()): string {
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
