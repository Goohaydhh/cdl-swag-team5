// Only the 5 weights the designs use are bundled (importing the package root would ship all of them).
import { Fredoka_500Medium } from '@expo-google-fonts/fredoka/500Medium';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka/600SemiBold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import type { PairingSessionDto } from '@swag/client';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { onSessionChange, type ParentSession, restoreSession } from './src/lib/session';
import { useFamily } from './src/lib/useFamily';
import { ChatScreen } from './src/screens/ChatScreen';
import { FamilyScreen } from './src/screens/FamilyScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { Onboarding } from './src/screens/Onboarding';
import { PairScreen } from './src/screens/PairScreen';
import { ValidateSheet } from './src/screens/ValidateSheet';
import { Icon, type IconName } from './src/ui/art';
import { C, F, s } from './src/ui/theme';

/** SWAG parent app: account, then Accueil / Chat / Famille. */
export default function App() {
  const [fontsLoaded] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold });
  const [session, setSession] = useState<ParentSession | null | undefined>(undefined);

  useEffect(() => {
    void restoreSession().then(setSession);
    return onSessionChange(setSession);
  }, []);

  if (!fontsLoaded || session === undefined) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
        {session ? <Main key={session.user.id} /> : <Onboarding />}
      </SafeAreaView>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

type Tab = 'home' | 'chat' | 'fam';

function Main() {
  const f = useFamily();
  const [tab, setTab] = useState<Tab>('home');
  const [pairing, setPairingView] = useState(false);
  const [validate, setValidate] = useState<{ id: string; model: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const onClaimed = useCallback(
    (session: PairingSessionDto) => {
      const model = f.pairing?.pairing_id === session.pairing_id ? String(f.pairing.device_info.model ?? 'Tablette') : 'Tablette';
      setValidate((v) => v ?? { id: session.pairing_id, model });
    },
    [f.pairing],
  );

  // A tablet joined while the parent was elsewhere in the app (or on the other parent's phone).
  const pendingClaim = f.pairing?.state === 'claimed' ? f.pairing : null;

  const tabs: [Tab, IconName, string, boolean][] = [
    ['home', 'house', 'Accueil', false],
    ['chat', 'chat', 'Chat', f.unread > 0 && tab !== 'chat'],
    ['fam', 'users', 'Famille', !!pendingClaim],
  ];

  return (
    <View style={{ flex: 1 }}>
      {pairing ? (
        <PairScreen f={f} onBack={() => setPairingView(false)} onClaimed={onClaimed} />
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'home' && <HomeScreen f={f} />}
            {tab === 'chat' && <ChatScreen f={f} />}
            {tab === 'fam' && (
              <FamilyScreen
                f={f}
                onPair={() => setPairingView(true)}
                onValidate={() => pendingClaim && setValidate({ id: pendingClaim.pairing_id, model: String(pendingClaim.device_info.model ?? 'Tablette') })}
              />
            )}
          </View>
          <View
            accessibilityRole="tablist"
            style={{ flexDirection: 'row', paddingTop: 10, paddingBottom: 22, paddingHorizontal: 8, backgroundColor: C.surface, shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 16, elevation: 8 }}
          >
            {tabs.map(([key, icon, label, dot]) => {
              const on = tab === key;
              return (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(key)} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 64, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primarySoft : 'transparent' }}>
                    <Icon name={icon} size={24} color={on ? C.primary : C.inkSoft} />
                    {dot && <View style={{ position: 'absolute', top: 2, right: 12, width: 10, height: 10, borderRadius: 5, backgroundColor: '#D9480F', borderWidth: 2, borderColor: C.surface }} />}
                  </View>
                  <Text style={{ fontFamily: F.b600, fontSize: 13, color: on ? C.primary : C.inkSoft }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <ValidateSheet
        f={f}
        pairingId={validate?.id ?? null}
        model={validate?.model ?? 'Tablette'}
        onDone={(approved) => {
          setValidate(null);
          setPairingView(false);
          setTab('fam');
          show(approved ? 'Tablette associée !' : 'Association refusée');
        }}
      />
      {toast && (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 100, alignSelf: 'center', backgroundColor: C.ink, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 }}>
          <Text style={{ fontFamily: F.b700, color: '#fff' }}>{toast}</Text>
        </View>
      )}
    </View>
  );
}
