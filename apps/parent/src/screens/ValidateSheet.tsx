import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../lib/session';
import type { Family } from '../lib/useFamily';
import { Gremlin, Icon, kidColor } from '../ui/art';
import { Button, Checkbox } from '../ui/kit';
import { C, s } from '../ui/theme';

/** P6 "Valider la tablette": the parent accepts the tablet that scanned the code and picks its children. */
export function ValidateSheet({ f, pairingId, model, onDone }: { f: Family; pairingId: string | null; model: string; onDone: (approved: boolean) => void }) {
  const kids = f.family?.children ?? [];
  const [chosen, setChosen] = useState<string[]>(kids.map((k) => k.id));
  const [name, setName] = useState('Tablette du salon');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pairingId) setChosen((f.family?.children ?? []).map((k) => k.id));
  }, [pairingId, f.family]);

  if (!pairingId) return null;
  const family = f.family?.name ?? 'ta famille';

  const act = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject');
    setError(null);
    try {
      if (approve) await api.approvePairing(pairingId, { device_name: name.trim() || 'Tablette', child_ids: chosen });
      else await api.rejectPairing(pairingId);
      f.clearPairing();
      await f.reload();
      onDone(approve);
    } catch {
      setError('Le code a peut-être expiré. Génère un nouveau code.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => act(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(42,27,77,.7)', justifyContent: 'flex-end' }}>
        <ScrollView
          style={{ backgroundColor: C.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '92%', flexGrow: 0 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 30, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.row}>
            <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="tablet" size={30} color={C.primary} />
            </View>
            <View style={s.grow}>
              <Text style={s.h3}>Associer « {model} » à {family} ?</Text>
              <Text style={s.cap}>Vérifie que c’est bien la tablette de tes enfants.</Text>
            </View>
          </View>
          <TextInput style={s.field} value={name} onChangeText={setName} maxLength={60} accessibilityLabel="Nom de la tablette" />
          <Text style={s.strong}>Qui utilisera cette tablette ?</Text>
          {kids.map((k) => {
            const on = chosen.includes(k.id);
            return (
              <Pressable
                key={k.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setChosen(on ? chosen.filter((c) => c !== k.id) : [...chosen, k.id])}
                style={[s.row, { paddingHorizontal: 12, height: 56, borderRadius: 20, backgroundColor: on ? C.primarySoft : C.background }]}
              >
                <Gremlin color={kidColor(k)} size={38} />
                <Text style={[s.strong, s.grow]}>{k.display_name}</Text>
                <Checkbox on={on} />
              </Pressable>
            );
          })}
          {error && <Text style={s.error}>{error}</Text>}
          <View style={[s.row, { gap: 10 }]}>
            <Button label="Refuser" variant="soft" style={{ flex: 1 }} onPress={() => act(false)} busy={busy === 'reject'} />
            <Button label="Associer" icon="check" style={{ flex: 1 }} onPress={() => act(true)} busy={busy === 'approve'} disabled={!chosen.length} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
