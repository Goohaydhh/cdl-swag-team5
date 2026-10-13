import { availabilityColor, availabilityLabel, statusColor, statusLabel, statusSoftColor } from '@swag/design-tokens';
import type { Availability, RingerMode } from '@swag/protocol';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { relativeTime, todayLabel } from '../lib/format';
import { api } from '../lib/session';
import type { Family } from '../lib/useFamily';
import type { AvatarTarget } from './AvatarEditor';
import { Icon, type IconName } from '../ui/art';
import { KidPic, ParentPic } from '../ui/AvatarPic';
import { Card, PARENT_COLORS } from '../ui/kit';
import { C, F, s } from '../ui/theme';

const STATUS_ICON: Record<string, IconName> = { at_home: 'house', left_home: 'door', at_friend: 'users' };
const ETAS = [10, 20, 30];

/** P1 "Accueil": the children's statuses, the parents, and my availability. */
export function HomeScreen({ f, onAvatar }: { f: Family; onAvatar: (t: AvatarTarget) => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [etaOpen, setEtaOpen] = useState(false);
  const o = f.overview;
  const mine = o?.parents.find((p) => p.id === f.me);
  const myName = mine?.display_name ?? '';

  const setAvail = async (status: Availability, eta?: number) => {
    f.setOverview((ov) => ov && { ...ov, parents: ov.parents.map((p) => (p.id === f.me ? { ...p, availability: status, eta_minutes: eta ?? null } : p)) });
    setEtaOpen(false);
    await api.setAvailability(status, eta).catch(() => f.reload());
  };

  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await f.reload().catch(() => undefined), setRefreshing(false))} />}
    >
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View>
          <Text style={s.cap}>{todayLabel()}</Text>
          <Text style={s.h1}>Salut {myName} !</Text>
        </View>
        {!f.online && (
          <View style={{ backgroundColor: C.sunSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={s.cap}>Hors ligne</Text>
          </View>
        )}
      </View>

      {mine && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onAvatar({ kind: 'me', name: myName, spec: mine.avatar_spec })}
          style={[s.card, s.row, { paddingVertical: 10, paddingHorizontal: 14, gap: 12 }]}
        >
          <ParentPic parent={mine} color={PARENT_COLORS[o!.parents.indexOf(mine) % PARENT_COLORS.length]!} size={48} />
          <View style={s.grow}>
            <Text style={s.strong}>{mine.avatar_spec ? 'Modifier mon avatar' : 'Créer mon avatar'}</Text>
            <Text style={s.cap}>Il apparaît partout à la place de ton initiale.</Text>
          </View>
          <Icon name="smile" size={24} color={C.primary} />
        </Pressable>
      )}

      {o?.children.length === 0 && (
        <Card style={{ padding: 16, gap: 6 }}>
          <Text style={s.h3}>Ajoute tes enfants</Text>
          <Text style={s.cap}>Va dans Famille pour créer leurs profils, puis associe la tablette.</Text>
        </Card>
      )}
      {o?.children.map((c) => {
        const st = c.status?.status;
        return (
          <Card key={c.id} style={[s.row, { paddingVertical: 12, paddingHorizontal: 14, gap: 14 }]}>
            <KidPic kid={c} size={52} />
            <View style={[s.grow, { gap: 6 }]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.h3}>{c.display_name}</Text>
                <Text style={s.cap}>{c.status ? relativeTime(c.status.occurred_at) : ''}</Text>
              </View>
              {st ? (
                <View style={[s.row, { alignSelf: 'flex-start', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: statusSoftColor[st] }]}>
                  <Icon name={STATUS_ICON[st]!} size={18} color={statusColor[st]} stroke={2.4} />
                  <Text style={{ fontFamily: F.b700, fontSize: 15, color: C.ink }}>{statusLabel[st]}</Text>
                </View>
              ) : (
                <Text style={s.cap}>Pas encore de statut</Text>
              )}
            </View>
          </Card>
        );
      })}

      {o && o.parents.length > 0 && (
        <Card style={{ padding: 14, gap: 12 }}>
          {o.parents.map((p, i) => (
            <View key={p.id} style={s.row}>
              <View>
                <ParentPic parent={p} color={PARENT_COLORS[i % PARENT_COLORS.length]!} />
                <RingerBadge mode={p.ringer} />
              </View>
              <View style={s.grow}>
                <Text style={s.strong}>{p.display_name}{p.id === f.me ? ' (moi)' : ''}</Text>
                <View style={[s.row, { gap: 6 }]}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: availabilityColor[p.availability] }} />
                  <Text style={s.cap}>
                    {availabilityLabel[p.availability]}
                    {p.availability === 'on_my_way' && p.eta_minutes ? ` · ${p.eta_minutes} min` : ''}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Text style={s.h3}>Ma disponibilité</Text>
      <View style={[s.row, { gap: 8 }]} accessibilityRole="radiogroup">
        {(['available', 'busy', 'on_my_way'] as const).map((a) => {
          const on = mine?.availability === a;
          return (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => (a === 'on_my_way' ? setEtaOpen(true) : setAvail(a))}
              style={{ flex: 1, height: 44, borderRadius: 999, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primary : C.surface, borderWidth: on ? 0 : 2, borderColor: C.border }}
            >
              {on && <Icon name="check" size={18} color="#fff" stroke={2.6} />}
              <Text style={{ fontFamily: F.b700, fontSize: 15, color: on ? '#fff' : C.ink }}>{availabilityLabel[a]}</Text>
            </Pressable>
          );
        })}
      </View>
      {etaOpen && (
        <Card style={{ padding: 14, gap: 10 }}>
          <Text style={s.strong}>Dans combien de temps arrives-tu ?</Text>
          <View style={[s.row, { gap: 8 }]}>
            {ETAS.map((m) => (
              <Pressable accessibilityRole="button" key={m} onPress={() => setAvail('on_my_way', m)} style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.b700, color: C.primaryDeep }}>{m} min</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setAvail('on_my_way')} style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.b700, color: C.ink }}>Sans heure</Text>
            </Pressable>
          </View>
        </Card>
      )}
    </ScrollView>
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
    <View
      accessible
      accessibilityLabel={b.label}
      style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface, borderWidth: 2, borderColor: C.background, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={b.icon} size={13} color={C.inkSoft} stroke={2.4} />
    </View>
  );
}
