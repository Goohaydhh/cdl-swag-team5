import type { PairingSessionDto } from '@swag/client';
import { SwagApiError } from '@swag/client';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '../lib/session';
import type { Family } from '../lib/useFamily';
import { Icon } from '../ui/art';
import { Button, Card, TopBar } from '../ui/kit';
import { C, F, s } from '../ui/theme';

/**
 * P5 "Associer une tablette": the parent generates the QR code and the code, the tablet
 * scans it. When the tablet has joined, the parent validates it (P6).
 */
export function PairScreen({ f, onBack, onClaimed }: { f: Family; onBack: () => void; onClaimed: (session: PairingSessionDto) => void }) {
  const [session, setSession] = useState<PairingSessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  const { clearPairing } = f;
  const generate = useCallback(async () => {
    setError(null);
    clearPairing();
    try {
      setSession(await api.createPairing());
    } catch (err) {
      setError(err instanceof SwagApiError && err.status === 0 ? 'Pas de connexion au serveur SWAG.' : 'Impossible de créer un code. Réessaie.');
    }
  }, [clearPairing]);

  useEffect(() => {
    void generate();
  }, [generate]);

  // Countdown, and fallback long-poll in case the socket event is missed.
  useEffect(() => {
    if (!session) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    const abort = new AbortController();
    (async () => {
      while (!abort.signal.aborted) {
        try {
          const st = await api.pairingState(session.pairing_id, 25, abort.signal);
          if (st.state === 'claimed') return onClaimed(session);
          if (st.state !== 'pending') return;
        } catch {
          if (abort.signal.aborted) return;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [session, onClaimed]);

  useEffect(() => {
    if (session && f.pairing?.pairing_id === session.pairing_id && f.pairing.state === 'claimed') onClaimed(session);
  }, [f.pairing, session, onClaimed]);

  const close = () => {
    if (session) void api.rejectPairing(session.pairing_id).catch(() => undefined); // cancels the unused code
    onBack();
  };

  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <View style={s.screen}>
      <TopBar title="Associer une tablette" onBack={close} />
      <ScrollView contentContainerStyle={[s.page, { alignItems: 'center', gap: 14, paddingTop: 14 }]}>
        <Text style={[s.h2, { textAlign: 'center' }]}>Montre ce code à la tablette de tes enfants</Text>
        <Text style={[s.cap, { textAlign: 'center', maxWidth: 300 }]}>Sur la tablette, ils scannent le QR code avec la caméra, ou tapent le code.</Text>
        {error && <Text style={s.error}>{error}</Text>}
        {session && left > 0 ? (
          <>
            <Card style={{ padding: 16 }}>
              <QRCode value={session.qr_payload} size={220} color={C.ink} backgroundColor="#FFFFFF" />
            </Card>
            <View style={{ backgroundColor: C.primarySoft, paddingHorizontal: 20, paddingVertical: 6, borderRadius: 20 }}>
              <Text style={{ fontFamily: F.d600, fontSize: 30, lineHeight: 40, color: C.primaryDeep, letterSpacing: 2 }} accessibilityLabel={`Code ${session.code.split('').join(' ')}`}>
                {session.code}
              </Text>
            </View>
            <View style={[s.row, { gap: 6 }]}>
              <Icon name="clock" size={16} color={C.inkSoft} />
              <Text style={s.cap}>Expire dans {mm} · utilisable une seule fois</Text>
            </View>
          </>
        ) : session ? (
          <Text style={s.h3}>Ce code a expiré.</Text>
        ) : null}
        <View style={[s.row, { width: '100%' }]}>
          <Button
            label={copied ? 'Copié !' : 'Copier le code'}
            icon="copy"
            variant="white"
            height={46}
            style={{ flex: 1 }}
            disabled={!session}
            onPress={async () => {
              if (!session) return;
              await Clipboard.setStringAsync(session.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
          <Button label="Nouveau code" icon="refresh" variant="white" height={46} style={{ flex: 1 }} onPress={() => (session && void api.rejectPairing(session.pairing_id).catch(() => undefined), void generate())} />
        </View>
        <View style={[s.row, { backgroundColor: C.sunSoft, borderRadius: 20, padding: 14, width: '100%' }]}>
          <Icon name="phone" size={22} />
          <Text style={[s.cap, { color: C.ink, flex: 1 }]}>Tu valideras l’association ici quand la tablette aura scanné.</Text>
        </View>
      </ScrollView>
    </View>
  );
}
