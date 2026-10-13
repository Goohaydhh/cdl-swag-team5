import { AVATAR_CATEGORIES, DEFAULT_AVATAR, randomAvatar, withPart } from '@swag/avatar';
import type { AvatarSpec } from '@swag/protocol';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session';
import { AvatarPic } from '../ui/AvatarPic';
import { Icon } from '../ui/art';
import { Button } from '../ui/kit';
import { C, F, s } from '../ui/theme';

/** Whose avatar is being edited: mine, or one of the children's. */
export type AvatarTarget = { kind: 'me'; name: string; spec: AvatarSpec | null } | { kind: 'child'; id: string; name: string; spec: AvatarSpec | null };

/**
 * "Créer mon avatar" on the parent phone: the same parts as the tablet (plus beards and
 * moustaches for parents). No camera here; the tablet has the camera step for children.
 */
export function AvatarEditor({ target, onClose, onSaved }: { target: AvatarTarget | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [draft, setDraft] = useState<AvatarSpec>(DEFAULT_AVATAR);
  const [tab, setTab] = useState(AVATAR_CATEGORIES[0]!.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDraft(target.spec ?? DEFAULT_AVATAR);
    setTab(AVATAR_CATEGORIES[0]!.key);
    setError(null);
  }, [target]);

  if (!target) return null;
  const categories = AVATAR_CATEGORIES.filter((c) => target.kind === 'me' || !c.parentOnly);
  const cat = categories.find((c) => c.key === tab) ?? categories[0]!;

  const save = async (spec: AvatarSpec | null) => {
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'me') await api.setMyAvatar(spec);
      else await api.setChildAvatar(target.id, spec);
      onSaved(target.kind === 'me' ? 'Ton avatar est prêt !' : `L’avatar de ${target.name} est prêt !`);
    } catch {
      setError('Pas de connexion. Réessaie dans un moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.screen}>
        <View style={[s.row, { paddingHorizontal: 16, paddingVertical: 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 8 }}>
            <Icon name="x" size={24} />
          </Pressable>
          <Text style={[s.h2, s.grow]}>{target.kind === 'me' ? 'Mon avatar' : `L’avatar de ${target.name}`}</Text>
        </View>

        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <AvatarPic spec={draft} size={168} />
          <Button
            label="Surprise"
            icon="refresh"
            variant="soft"
            height={44}
            onPress={() => setDraft((d) => ({ ...randomAvatar(), skin: d.skin, face: d.face, facial_hair: d.facial_hair }))}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }} style={{ flexGrow: 0 }}>
          {categories.map((c) => {
            const on = c.key === cat.key;
            return (
              <Pressable
                key={c.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(c.key)}
                style={{ height: 40, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? C.primarySoft : C.surface, borderWidth: 2, borderColor: on ? C.primary : C.border }}
              >
                <Text style={{ fontFamily: F.b700, fontSize: 14, color: on ? C.primaryDeep : C.ink }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 16, justifyContent: 'center' }}>
          {cat.options.map((o) => {
            const on = draft[cat.key] === o.value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: on }}
                onPress={() => setDraft((d) => withPart(d, cat.key, o.value))}
                style={{ width: 92, height: 92, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primarySoft : C.surface, borderWidth: on ? 4 : 2, borderColor: on ? C.primary : C.border }}
              >
                {cat.kind === 'swatch' ? (
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: o.color, borderWidth: 2, borderColor: 'rgba(42,27,77,0.12)' }} />
                ) : (
                  <AvatarPic spec={withPart(draft, cat.key, o.value)} size={72} zoom={cat.zoom} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ padding: 16, gap: 10 }}>
          {error && <Text style={[s.cap, { color: C.danger, textAlign: 'center' }]}>{error}</Text>}
          <Button label="Enregistrer" icon="check" busy={busy} onPress={() => void save(draft)} />
          {target.spec && (
            <Button
              label={target.kind === 'me' ? 'Revenir à mon initiale' : 'Revenir au Gremlin'}
              variant="line"
              height={44}
              disabled={busy}
              onPress={() => void save(null)}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
