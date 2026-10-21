import type { InviteDto } from '@swag/client';
import { SwagApiError } from '@swag/client';
import { gremlinAvatars } from '@swag/design-tokens';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { relativeTime } from '../lib/format';
import { api, signOut } from '../lib/session';
import type { Family } from '../lib/useFamily';
import { Gremlin, Icon, kidColor } from '../ui/art';
import { Button, Card, Initial, PARENT_COLORS } from '../ui/kit';
import { C, F, s } from '../ui/theme';

/** P7 "Famille et appareils": children, parents, the pairing entry point, tablets and phones. */
export function FamilyScreen({ f, onPair, onValidate }: { f: Family; onPair: () => void; onValidate: () => void }) {
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const tablets = f.devices.filter((d) => d.kind === 'child_tablet');
  const phones = f.devices.filter((d) => d.kind === 'parent_phone');
  const parents = f.family?.parents ?? [];
  const waiting = f.pairing?.state === 'claimed';

  const revokeTablet = (id: string, name: string) =>
    Alert.alert(`Retirer « ${name} » ?`, 'Elle ne pourra plus envoyer de statut ni de message. Il faudra la réassocier.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => void api.revokeDevice(id).then(f.reload) },
    ]);

  // Test feedback: a parent had 11 "Téléphone Android" in the family and no way to remove any.
  const revokePhone = (id: string, label: string) =>
    Alert.alert(
      `Retirer « ${label} » ?`,
      'Ce téléphone sera déconnecté de SWAG. Il faudra s’y reconnecter avec son e-mail et son mot de passe.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Retirer', style: 'destructive', onPress: () => void api.revokeDevice(id).then(f.reload) },
      ],
    );

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
        <AddLink label="Ajouter" onPress={() => setAdding(true)} />
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {f.family?.children.map((c) => (
          <View key={c.id} style={[s.row, { paddingVertical: 10, paddingHorizontal: 16 }]}>
            <Gremlin color={kidColor(c)} size={44} />
            <View style={s.grow}>
              <Text style={s.strong}>{c.display_name}</Text>
              <Text style={s.cap}>{tablets.some((t) => t.child_ids.includes(c.id)) ? 'Sur la tablette' : 'Pas encore sur une tablette'}</Text>
            </View>
          </View>
        ))}
        {!f.family?.children.length && <Text style={[s.cap, { padding: 16 }]}>Aucun enfant pour l’instant.</Text>}
      </Card>

      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.h3}>Parents</Text>
        <AddLink label="Inviter" onPress={() => setInviting(true)} />
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {parents.map((p, i) => (
          <View key={p.id} style={[s.row, { paddingVertical: 10, paddingHorizontal: 16 }]}>
            <Initial name={p.display_name} color={PARENT_COLORS[i % PARENT_COLORS.length]!} />
            <View style={s.grow}>
              <Text style={s.strong}>{p.display_name}{p.id === f.me ? ' (moi)' : ''}</Text>
              <Text style={s.cap}>{p.is_owner ? 'A créé la famille' : 'Parent'}</Text>
            </View>
          </View>
        ))}
      </Card>
      {parents.length < 2 && (
        <Text style={s.cap}>Tu peux inviter l’autre parent : il recevra un code à taper dans SWAG.</Text>
      )}

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
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${d.name}`} onPress={() => revokeTablet(d.id, d.name)} style={{ padding: 8 }}>
              <Icon name="trash" size={20} color={C.inkSoft} />
            </Pressable>
          </View>
        ))}
        {phones.map((d) => {
          const owner = parents.find((p) => p.id === d.owner_user_id);
          const label = owner ? `Téléphone de ${owner.display_name}` : d.name;
          return (
            <View key={d.id} style={[s.row, { paddingVertical: 12, paddingHorizontal: 16 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#D9F5E7', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="phone" size={22} color="#0B8F55" />
              </View>
              <View style={s.grow}>
                <Text style={s.strong}>{label}</Text>
                <Text style={s.cap}>
                  {d.name}
                  {d.last_seen_at ? ` · vu ${relativeTime(d.last_seen_at)}` : ''}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${label}`} onPress={() => revokePhone(d.id, label)} style={{ padding: 8 }}>
                <Icon name="trash" size={20} color={C.inkSoft} />
              </Pressable>
            </View>
          );
        })}
        {!f.devices.length && <Text style={[s.cap, { padding: 16 }]}>Aucun appareil pour l’instant.</Text>}
      </Card>

      <Button label="Me déconnecter" icon="logout" variant="white" onPress={() => void signOut()} />
      <AddChild visible={adding} onClose={() => setAdding(false)} onAdded={() => (setAdding(false), void f.reload())} />
      <InviteParent visible={inviting} onClose={() => (setInviting(false), void f.reload())} />
    </ScrollView>
  );
}

function AddLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 4 }]}>
      <Icon name="plus" size={18} color={C.primary} stroke={2.6} />
      <Text style={{ fontFamily: F.b700, color: C.primary }}>{label}</Text>
    </Pressable>
  );
}

/** Bottom sheet shell shared by "Ajouter un enfant" and "Inviter un autre parent". */
function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(42,27,77,.7)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 20, paddingBottom: 30, gap: 14 }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/**
 * FR-3 "Inviter un autre parent": the API already issued these codes, the app never asked for
 * one — so a second adult had no way in (test feedback, 21/10/2026). The other parent types the
 * code in "Rejoindre ma famille" when creating their account.
 */
function InviteParent({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [invite, setInvite] = useState<InviteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setError(null);
    setInvite(null);
    try {
      setInvite(await api.createInvite());
    } catch (err) {
      setError(
        err instanceof SwagApiError && err.status === 0
          ? 'Pas de connexion au serveur SWAG.'
          : 'Impossible de créer un code. Réessaie.',
      );
    }
  }, []);

  useEffect(() => {
    if (visible) void generate();
  }, [visible, generate]);

  const share = () => {
    if (!invite) return;
    void Share.share({
      message: `Rejoins notre famille sur SWAG : installe l’app, choisis « Rejoindre ma famille » et tape le code ${invite.code} (valable 24 h).`,
    }).catch(() => undefined);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={s.h3}>Inviter un autre parent</Text>
      <Text style={s.cap}>
        Il installe SWAG, choisit « Rejoindre ma famille » et tape ce code. Il verra les mêmes statuts et le même chat que toi.
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
      {invite && (
        <>
          <View style={{ backgroundColor: C.primarySoft, paddingVertical: 10, borderRadius: 20, alignItems: 'center' }}>
            <Text
              style={{ fontFamily: F.d600, fontSize: 30, lineHeight: 40, color: C.primaryDeep, letterSpacing: 2 }}
              accessibilityLabel={`Code ${invite.code.split('').join(' ')}`}
            >
              {invite.code}
            </Text>
          </View>
          <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
            <Icon name="clock" size={16} color={C.inkSoft} />
            <Text style={s.cap}>Valable 24 h · utilisable une seule fois</Text>
          </View>
          <View style={[s.row, { gap: 10 }]}>
            <Button
              label={copied ? 'Copié !' : 'Copier'}
              icon="copy"
              variant="white"
              height={46}
              style={{ flex: 1 }}
              onPress={async () => {
                await Clipboard.setStringAsync(invite.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            <Button label="Envoyer" icon="send" height={46} style={{ flex: 1 }} onPress={share} />
          </View>
        </>
      )}
      {!invite && !error && <Text style={s.cap}>Création du code…</Text>}
      <View style={[s.row, { gap: 10 }]}>
        <Button label="Nouveau code" icon="refresh" variant="white" height={46} style={{ flex: 1 }} onPress={() => void generate()} />
        <Button label="Fermer" variant="soft" height={46} style={{ flex: 1 }} onPress={onClose} />
      </View>
    </Sheet>
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
    <Sheet visible={visible} onClose={onClose}>
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
    </Sheet>
  );
}
