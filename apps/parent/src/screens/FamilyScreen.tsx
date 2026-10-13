import { gremlinAvatars } from '@swag/design-tokens';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { relativeTime } from '../lib/format';
import { api, signOut } from '../lib/session';
import type { Family } from '../lib/useFamily';
import type { AvatarTarget } from './AvatarEditor';
import { Gremlin, Icon } from '../ui/art';
import { KidPic } from '../ui/AvatarPic';
import { Button, Card } from '../ui/kit';
import { C, F, s } from '../ui/theme';

/** P7 "Famille et appareils": children, the pairing entry point, tablets and phones. */
export function FamilyScreen({
  f,
  onPair,
  onValidate,
  onAvatar,
}: {
  f: Family;
  onPair: () => void;
  onValidate: () => void;
  onAvatar: (t: AvatarTarget) => void;
}) {
  const [adding, setAdding] = useState(false);
  const tablets = f.devices.filter((d) => d.kind === 'child_tablet');
  const phones = f.devices.filter((d) => d.kind === 'parent_phone');
  const waiting = f.pairing?.state === 'claimed';

  const revoke = (id: string, name: string) =>
    Alert.alert(`Retirer « ${name} » ?`, 'Elle ne pourra plus envoyer de statut ni de message. Il faudra la réassocier.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => void api.revokeDevice(id).then(f.reload) },
    ]);

  const allowCamera = (id: string, on: boolean) => void api.updateChild(id, { avatar_camera_allowed: on }).then(f.reload, f.reload);

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h1}>{f.family?.name ?? 'Ma famille'}</Text>

      {waiting && (
        <Card style={{ padding: 14, gap: 10, backgroundColor: C.sunSoft, shadowOpacity: 0, elevation: 0 }}>
          <View style={s.row}>
            <Icon name="tablet" size={26} />
            <View style={s.grow}>
              <Text style={s.strong}>Une tablette a scanné ton code</Text>
              <Text style={s.cap}>{String(f.pairing?.device_info.model ?? 'Tablette')} attend ton accord</Text>
            </View>
          </View>
          <Button label="Valider la tablette" onPress={onValidate} />
        </Card>
      )}

      <Button label={tablets.length ? 'Associer une autre tablette' : 'Associer une tablette'} icon="tablet" variant={tablets.length ? 'soft' : 'primary'} onPress={onPair} disabled={!f.family?.children.length} />
      {!f.family?.children.length && <Text style={s.cap}>Ajoute d’abord un enfant pour pouvoir associer une tablette.</Text>}

      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.h3}>Enfants</Text>
        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={[s.row, { gap: 4 }]}>
          <Icon name="plus" size={18} color={C.primary} stroke={2.6} />
          <Text style={{ fontFamily: F.b700, color: C.primary }}>Ajouter</Text>
        </Pressable>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {f.family?.children.map((c) => (
          <View key={c.id} style={{ paddingVertical: 10, paddingHorizontal: 16, gap: 10 }}>
            <View style={s.row}>
              <KidPic kid={c} size={44} />
              <View style={s.grow}>
                <Text style={s.strong}>{c.display_name}</Text>
                <Text style={s.cap}>{tablets.some((t) => t.child_ids.includes(c.id)) ? 'Sur la tablette' : 'Pas encore sur une tablette'}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Avatar de ${c.display_name}`}
                onPress={() => onAvatar({ kind: 'child', id: c.id, name: c.display_name, spec: c.avatar_spec })}
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.primarySoft, justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: F.b700, fontSize: 14, color: C.primaryDeep }}>Avatar</Text>
              </Pressable>
            </View>
            <View style={[s.row, { gap: 10 }]}>
              <View style={s.grow}>
                <Text style={[s.cap, { color: C.ink }]}>Caméra pour créer son avatar</Text>
                <Text style={s.cap}>La tablette regarde son visage pour proposer les couleurs. La photo n’est ni envoyée ni gardée.</Text>
              </View>
              <Switch
                accessibilityLabel={`Autoriser la caméra pour l’avatar de ${c.display_name}`}
                value={c.avatar_camera_allowed}
                onValueChange={(on) => allowCamera(c.id, on)}
                trackColor={{ true: C.primary, false: C.border }}
                thumbColor="#fff"
              />
            </View>
          </View>
        ))}
        {!f.family?.children.length && <Text style={[s.cap, { padding: 16 }]}>Aucun enfant pour l’instant.</Text>}
      </Card>

      <Text style={s.h3}>Appareils</Text>
      <Card style={{ paddingVertical: 4 }}>
        {tablets.map((d) => (
          <View key={d.id} style={[s.row, { paddingVertical: 12, paddingHorizontal: 16 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="tablet" size={22} color={C.primary} />
            </View>
            <View style={s.grow}>
              <Text style={s.strong}>{d.name}</Text>
              <Text style={s.cap}>
                {String(d.platform_info.model ?? 'Tablette')} · {d.last_seen_at ? `vue ${relativeTime(d.last_seen_at)}` : 'jamais connectée'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${d.name}`} onPress={() => revoke(d.id, d.name)} style={{ padding: 8 }}>
              <Icon name="trash" size={20} color={C.inkSoft} />
            </Pressable>
          </View>
        ))}
        {phones.map((d) => (
          <View key={d.id} style={[s.row, { paddingVertical: 12, paddingHorizontal: 16 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#D9F5E7', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="phone" size={22} color="#0B8F55" />
            </View>
            <View style={s.grow}>
              <Text style={s.strong}>{d.name}</Text>
              <Text style={s.cap}>Téléphone d’un parent</Text>
            </View>
          </View>
        ))}
      </Card>

      <Button label="Me déconnecter" icon="logout" variant="white" onPress={() => void signOut()} />
      <AddChild visible={adding} onClose={() => setAdding(false)} onAdded={() => (setAdding(false), void f.reload())} />
    </ScrollView>
  );
}

const AVATARS = Object.entries(gremlinAvatars);

function AddChild({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]![0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createChild({ display_name: name.trim(), avatar_key: avatar, color: gremlinAvatars[avatar as keyof typeof gremlinAvatars] });
      setName('');
      onAdded();
    } catch {
      setError('Impossible d’ajouter cet enfant. Réessaie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(42,27,77,.7)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 20, paddingBottom: 30, gap: 14 }}>
          <Text style={s.h3}>Ajouter un enfant</Text>
          <TextInput style={s.field} placeholder="Prénom" placeholderTextColor={C.inkSoft} value={name} onChangeText={setName} maxLength={30} accessibilityLabel="Prénom" />
          <Text style={s.strong}>Son Gremlin</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {AVATARS.map(([key, col]) => (
              <Pressable accessibilityRole="button" key={key} accessibilityLabel={`Gremlin ${key}`} onPress={() => setAvatar(key)} style={{ padding: 4, borderRadius: 16, borderWidth: 3, borderColor: avatar === key ? C.primary : 'transparent' }}>
                <Gremlin color={col} size={52} />
              </Pressable>
            ))}
          </View>
          <Text style={s.cap}>Seuls le prénom et l’avatar sont enregistrés. Pas de date de naissance, pas de photo.</Text>
          {error && <Text style={s.error}>{error}</Text>}
          <View style={[s.row, { gap: 10 }]}>
            <Button label="Annuler" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Ajouter" icon="check" onPress={add} busy={busy} disabled={!name.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
