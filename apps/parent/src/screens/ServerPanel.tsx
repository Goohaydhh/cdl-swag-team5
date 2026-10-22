import { useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';
import { API_URL, DEFAULT_API_URL, normalizeServer, saveServer, testServer } from '../lib/config';
import { Button } from '../ui/kit';
import { C, s } from '../ui/theme';

/** Lets a tester point the app at another SWAG server (PC, tablet, tunnel) without rebuilding it. */
export function ServerPanel({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(API_URL);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    const url = normalizeServer(value);
    if (!url) return setMsg('Adresse invalide. Exemple : http://192.168.1.20:5173');
    setBusy(true);
    const r = await testServer(url);
    setBusy(false);
    setMsg(
      r === 'ok'
        ? 'Le serveur répond.'
        : r === 'degraded'
          ? 'Le serveur répond, mais il signale un problème.'
          : 'Pas de réponse. Vérifie l’adresse et le Wi-Fi.',
    );
  };
  const save = () => {
    const url = normalizeServer(value);
    if (!url) return setMsg('Adresse invalide.');
    saveServer(url);
    setMsg('Enregistré. Ferme complètement l’app puis rouvre-la.');
  };
  const reset = () => {
    saveServer(null);
    setValue(DEFAULT_API_URL);
    setMsg('Adresse par défaut remise. Ferme complètement l’app puis rouvre-la.');
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 20, gap: 12 }}>
          <Text style={s.h2}>Serveur SWAG</Text>
          <Text style={s.cap}>Adresse actuelle : {API_URL}</Text>
          <TextInput
            style={s.field}
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.20:5173"
            placeholderTextColor={C.inkSoft}
            accessibilityLabel="Adresse du serveur"
          />
          {msg && <Text style={[s.cap, { color: C.ink }]}>{msg}</Text>}
          <Button label="Tester" variant="soft" onPress={test} busy={busy} />
          <Button label="Enregistrer" onPress={save} />
          <Button label="Adresse par défaut" variant="line" onPress={reset} />
          <Button label="Fermer" variant="white" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
