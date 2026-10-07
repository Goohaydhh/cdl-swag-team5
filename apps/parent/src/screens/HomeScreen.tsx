import { availabilityColor, availabilityLabel, statusColor, statusLabel, statusSoftColor } from '@swag/design-tokens';
import type { Availability } from '@swag/protocol';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { relativeTime, todayLabel } from '../lib/format';
import { api } from '../lib/session';
import type { Family } from '../lib/useFamily';
import { Gremlin, Icon, type IconName, kidColor } from '../ui/art';
import { Card, Initial, PARENT_COLORS } from '../ui/kit';
import { C, F, s } from '../ui/theme';

const STATUS_ICON: Record<string, IconName> = { at_home: 'house', left_home: 'door', at_friend: 'users' };
const ETAS = [10, 20, 30];

/** P1 "Accueil": the children's statuses, the parents, and my availability. */
export function HomeScreen({ f }: { f: Family }) {
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
            <Gremlin color={kidColor(c)} size={52} />
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
              <Initial name={p.display_name} color={PARENT_COLORS[i % PARENT_COLORS.length]!} />
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
              {p.ringer === 'silent' && (
                <View style={[s.row, { gap: 6, backgroundColor: C.background, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }]}>
                  <Icon name="bellOff" size={16} color={C.inkSoft} />
                  <Text style={s.cap}>Silencieux</Text>
                </View>
              )}
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
