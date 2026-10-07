import { SwagApiError } from '@swag/client';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { DEVICE_NAME } from '../lib/config';
import { api, signedIn } from '../lib/session';
import { Gremlin } from '../ui/art';
import { Button, Checkbox } from '../ui/kit';
import { C, s } from '../ui/theme';

/** P0 "Créer ma famille" (register) or sign in. */
export function Onboarding() {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [familyName, setFamilyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const device = { name: DEVICE_NAME };
      const res =
        mode === 'register'
          ? await api.register({ family_name: familyName.trim(), display_name: name.trim(), email: email.trim(), password, consent: true, device })
          : await api.login({ email: email.trim(), password, device });
      await signedIn(res);
    } catch (err) {
      if (err instanceof SwagApiError) {
        if (err.status === 0) setError('Pas de connexion au serveur SWAG.');
        else if (err.code === 'INVALID_CREDENTIALS') setError('E-mail ou mot de passe incorrect.');
        else if (err.code === 'CONFLICT') setError('Un compte existe déjà avec cet e-mail.');
        else if (err.code === 'VALIDATION') setError('Vérifie les champs : mot de passe de 10 caractères minimum.');
        else setError(err.message);
      } else setError('Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const valid =
    mode === 'login' ? email.includes('@') && password.length > 0 : familyName.trim() && name.trim() && email.includes('@') && password.length >= 10 && consent;

  const field = (label: string, value: string, set: (v: string) => void, opts: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={[s.cap, { color: C.ink }]}>{label}</Text>
      <TextInput style={s.field} value={value} onChangeText={set} placeholderTextColor={C.inkSoft} accessibilityLabel={label} {...opts} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.page, { gap: 14, paddingTop: 16 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Gremlin color={C.primary} size={84} />
          <Text style={[s.h1, { color: C.primary }]}>SWAG</Text>
          <Text style={s.cap}>Signal When Arrived, Gremlin !</Text>
        </View>
        <Text style={s.h2}>{mode === 'register' ? 'Crée le compte de ta famille' : 'Content de te revoir'}</Text>
        {mode === 'register' && field('Nom de la famille', familyName, setFamilyName, { placeholder: 'Famille Martin' })}
        {mode === 'register' && field('Ton prénom', name, setName, { placeholder: 'Marie', autoComplete: 'given-name' })}
        {field('Adresse e-mail', email, setEmail, { placeholder: 'marie@exemple.fr', autoCapitalize: 'none', keyboardType: 'email-address', autoComplete: 'email' })}
        {field('Mot de passe', password, setPassword, { placeholder: mode === 'register' ? '10 caractères minimum' : '', secureTextEntry: true })}
        {mode === 'register' && (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={[s.row, { alignItems: 'flex-start', gap: 10 }]}>
            <Checkbox on={consent} />
            <Text style={[s.cap, { color: C.ink, flex: 1 }]}>
              Je consens à ce que SWAG enregistre le prénom et l’avatar de mes enfants. Aucune position GPS, aucune date de naissance.
            </Text>
          </Pressable>
        )}
        {error && <Text style={s.error}>{error}</Text>}
        <Button label={mode === 'register' ? 'Créer ma famille' : 'Me connecter'} onPress={submit} busy={busy} disabled={!valid} />
        <Pressable accessibilityRole="button" onPress={() => (setMode(mode === 'register' ? 'login' : 'register'), setError(null))} style={{ paddingVertical: 8 }}>
          <Text style={[s.cap, { textAlign: 'center', color: C.primary }]}>
            {mode === 'register' ? 'J’ai déjà un compte · Me connecter' : 'Pas encore de compte · Créer ma famille'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
