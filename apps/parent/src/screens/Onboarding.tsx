import { formatCode, SwagApiError } from '@swag/client';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, thisDevice } from '../lib/config';
import { api, signedIn } from '../lib/session';
import { Gremlin } from '../ui/art';
import { Button, Checkbox } from '../ui/kit';
import { C, s } from '../ui/theme';
import { ServerPanel } from './ServerPanel';

/**
 * P0: create the family (register), sign in, or join a family that invited you.
 *
 * "Rejoindre ma famille" was missing until the 21/10/2026 test, where a second adult could not
 * find how to get on the app: the API already issued invite codes, nothing asked for one.
 */
type Mode = 'register' | 'login' | 'invite';

const TITLE: Record<Mode, string> = {
  register: 'Crée le compte de ta famille',
  login: 'Content de te revoir',
  invite: 'Rejoins ta famille',
};

export function Onboarding() {
  const [mode, setMode] = useState<Mode>('register');
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(false);
  // No tab bar on this screen, so nothing else reserves room for the navigation bar and it was
  // sitting over the server section at the bottom (test feedback, 22/10/2026).
  const insets = useSafeAreaInsets();

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const device = thisDevice();
      const res =
        mode === 'register'
          ? await api.register({ family_name: familyName.trim(), display_name: name.trim(), email: email.trim(), password, consent: true, device })
          : mode === 'invite'
            ? await api.acceptInvite({ code: code.trim(), display_name: name.trim(), email: email.trim(), password, consent: true, device })
            : await api.login({ email: email.trim(), password, device });
      await signedIn(res);
    } catch (err) {
      if (err instanceof SwagApiError) {
        if (err.status === 0) setError('Pas de connexion au serveur SWAG.');
        else if (err.code === 'INVALID_CREDENTIALS') setError('E-mail ou mot de passe incorrect.');
        else if (err.code === 'CONFLICT') setError('Un compte existe déjà avec cet e-mail.');
        else if (err.code === 'PAIRING_NOT_FOUND') setError('Ce code n’existe pas ou a déjà été utilisé.');
        else if (err.code === 'PAIRING_EXPIRED') setError('Ce code a expiré. Demande-en un nouveau.');
        else if (err.code === 'VALIDATION') setError('Vérifie les champs : mot de passe de 10 caractères minimum.');
        else setError(err.message);
      } else setError('Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const codeDigits = code.replace(/[^0-9a-z]/gi, '').length;
  const account = name.trim() && email.includes('@') && password.length >= 10 && consent;
  const valid =
    mode === 'login'
      ? email.includes('@') && password.length > 0
      : mode === 'invite'
        ? codeDigits === 8 && account
        : familyName.trim() && account;

  const field = (label: string, value: string, set: (v: string) => void, opts: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={[s.cap, { color: C.ink }]}>{label}</Text>
      <TextInput style={s.field} value={value} onChangeText={set} placeholderTextColor={C.inkSoft} accessibilityLabel={label} {...opts} />
    </View>
  );

  return (
    // "padding" on Android too: with edge-to-edge the keyboard covers the fields otherwise.
    <KeyboardAvoidingView style={s.screen} behavior="padding">
      <ScrollView contentContainerStyle={[s.page, { gap: 14, paddingTop: 16, paddingBottom: 16 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Gremlin color={C.primary} size={84} />
          <Text style={[s.h1, { color: C.primary }]}>SWAG</Text>
          <Text style={s.cap}>Signal When Arrived, Gremlin !</Text>
        </View>
        <Text style={s.h2}>{TITLE[mode]}</Text>

        {mode === 'invite' && (
          <>
            <Text style={s.cap}>
              Tape le code que l’autre parent t’a envoyé. Il le trouve dans SWAG, sur « Famille », puis « Inviter un autre parent ».
            </Text>
            {field('Code reçu', code, (v) => setCode(formatCode(v)), {
              placeholder: 'K7QF-9M2D',
              autoCapitalize: 'characters',
              autoCorrect: false,
              maxLength: 9,
            })}
          </>
        )}
        {mode === 'register' && field('Nom de la famille', familyName, setFamilyName, { placeholder: 'Famille Martin' })}
        {mode !== 'login' && field('Ton prénom', name, setName, { placeholder: 'Marie', autoComplete: 'given-name' })}
        {field('Adresse e-mail', email, setEmail, { placeholder: 'marie@exemple.fr', autoCapitalize: 'none', keyboardType: 'email-address', autoComplete: 'email' })}
        {field('Mot de passe', password, setPassword, { placeholder: mode === 'login' ? '' : '10 caractères minimum', secureTextEntry: true })}

        {mode !== 'login' && (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={[s.row, { alignItems: 'flex-start', gap: 10 }]}>
            <Checkbox on={consent} />
            <Text style={[s.cap, { color: C.ink, flex: 1 }]}>
              Je consens à ce que SWAG enregistre le prénom et l’avatar de mes enfants. Aucune position GPS, aucune date de naissance.
            </Text>
          </Pressable>
        )}
        {error && <Text style={s.error}>{error}</Text>}
        <Button
          label={mode === 'register' ? 'Créer ma famille' : mode === 'invite' ? 'Rejoindre ma famille' : 'Me connecter'}
          onPress={submit}
          busy={busy}
          disabled={!valid}
        />

        {mode !== 'login' && (
          <Link label="J’ai déjà un compte · Me connecter" onPress={() => go('login')} />
        )}
        {mode !== 'invite' && (
          <Link label="On m’a envoyé un code · Rejoindre ma famille" onPress={() => go('invite')} />
        )}
        {mode !== 'register' && (
          <Link label="Pas encore de famille · En créer une" onPress={() => go('register')} />
        )}

        <Pressable accessibilityRole="button" onPress={() => setServer(true)} style={{ paddingVertical: 8 }}>
          <Text style={[s.cap, { textAlign: 'center' }]}>Serveur : {API_URL.replace(/^https?:\/\//, '')}</Text>
        </Pressable>
        {server && <ServerPanel onClose={() => setServer(false)} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingVertical: 8 }}>
      <Text style={[s.cap, { textAlign: 'center', color: C.primary }]}>{label}</Text>
    </Pressable>
  );
}
