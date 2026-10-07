import { type GifSearchResult, speakerLabel, SwagApiError } from '@swag/client';
import { swagStickers } from '@swag/design-tokens';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockTime } from '../lib/format';
import { useMediaUrl } from '../lib/media';
import { api } from '../lib/session';
import type { ChatItem, Family } from '../lib/useFamily';
import { Gremlin, Icon, kidColor, Sticker } from '../ui/art';
import { Button, GremlinStack, TopBar } from '../ui/kit';
import { C, F, s, shadowCard } from '../ui/theme';

type Panel = null | 'stickers' | 'gif';

/** P2 "Chat famille" (the only conversation), P3 GIFs, P4 a drawing in full screen. */
export function ChatScreen({ f }: { f: Family }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState<ChatItem | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  const { markRead, setChatOpen } = f;
  const kids = f.overview?.children ?? [];
  const members = [...kids.map((k) => k.display_name), ...(f.overview?.parents ?? []).map((p) => (p.id === f.me ? 'toi' : p.display_name))];

  useEffect(() => {
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [setChatOpen]);
  useEffect(() => {
    markRead();
  }, [f.messages.length, markRead]);

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    f.typing(false);
    void f.send({ kind: 'text', body });
  };

  const typingNames = f.typingKids.map((id) => kids.find((k) => k.id === id)?.display_name).filter(Boolean) as string[];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar
        title="Toute la famille"
        subtitle={members.join(', ')}
        right={
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="users" size={22} color={C.primary} />
          </View>
        }
      />
      <FlatList
        ref={listRef}
        data={f.messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 10, paddingTop: 60 }}>
            <Gremlin color={C.primary} size={96} />
            <Text style={s.h2}>Dis bonjour à ta famille !</Text>
            <Text style={[s.cap, { textAlign: 'center' }]}>Les messages, dessins et autocollants des enfants arrivent ici.</Text>
          </View>
        }
        ListFooterComponent={
          typingNames.length ? <Text style={[s.cap, { marginTop: 8 }]}>{speakerLabel(typingNames)} écrit…</Text> : null
        }
        renderItem={({ item }) => <MessageRow m={item} f={f} onOpen={setViewing} />}
      />

      {panel === 'stickers' && (
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', paddingHorizontal: 12, paddingTop: 10, backgroundColor: C.surface }}>
          {swagStickers.map((code) => (
            <Pressable accessibilityRole="button" key={code} accessibilityLabel="Envoyer un autocollant" onPress={() => void f.send({ kind: 'sticker', sticker_code: code })} style={{ width: 58, height: 58, borderRadius: 16, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' }}>
              <Sticker code={code} size={40} />
            </Pressable>
          ))}
        </View>
      )}
      {panel === 'gif' && <GifPanel onPick={(ref) => (void f.send({ kind: 'gif', gif_ref: ref }), setPanel(null))} />}

      <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.surface, gap: 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Autocollants" onPress={() => setPanel(panel === 'stickers' ? null : 'stickers')} style={pill(panel === 'stickers')}>
          <Icon name="smile" size={24} color={panel === 'stickers' ? '#fff' : C.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="GIF" onPress={() => setPanel(panel === 'gif' ? null : 'gif')} style={[pill(panel === 'gif'), { width: undefined, paddingHorizontal: 12 }]}>
          <Text style={{ fontFamily: F.b700, fontSize: 14, color: panel === 'gif' ? '#fff' : C.primary }}>GIF</Text>
        </Pressable>
        <TextInput
          style={{ flex: 1, minWidth: 0, height: 48, borderRadius: 999, backgroundColor: C.background, paddingHorizontal: 16, fontFamily: F.b600, fontSize: 16, color: C.ink }}
          placeholder="Écrire un message"
          placeholderTextColor={C.inkSoft}
          value={text}
          onChangeText={(v) => (setText(v), f.typing(v.length > 0))}
          onSubmitEditing={sendText}
          returnKeyType="send"
          accessibilityLabel="Message"
          maxLength={2000}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Envoyer" onPress={sendText} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={22} color="#fff" />
        </Pressable>
      </View>

      <DrawingViewer m={viewing} f={f} onClose={() => setViewing(null)} />
    </KeyboardAvoidingView>
  );
}

const pill = (on: boolean) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: on ? C.primary : C.primarySoft,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});

function speakersOf(m: ChatItem, f: Family) {
  const kids = f.overview?.children ?? [];
  const ids = m.speaker_ids.length ? m.speaker_ids : m.sender.type === 'child' ? [m.sender.id] : [];
  return ids.map((id) => kids.find((k) => k.id === id)).filter((k): k is NonNullable<typeof k> => !!k);
}

function MessageRow({ m, f, onOpen }: { m: ChatItem; f: Family; onOpen: (m: ChatItem) => void }) {
  const mine = m.sender.type === 'user' && m.sender.id === f.me;
  const kids = speakersOf(m, f);
  const otherParent = m.sender.type === 'user' && !mine ? f.overview?.parents.find((p) => p.id === m.sender.id) : null;
  const who = kids.length ? `${speakerLabel(kids.map((k) => k.display_name))}${kids.length > 1 ? ' · message commun' : ''}` : (otherParent?.display_name ?? '');
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {!mine && who ? <Text style={[s.cap, { marginLeft: kids.length ? 40 : 0, marginBottom: 2 }]}>{who}</Text> : null}
      <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
        {kids.length > 0 && <GremlinStack colors={kids.slice(0, 3).map(kidColor)} size={kids.length > 1 ? 26 : 32} />}
        <Content m={m} mine={mine} onOpen={onOpen} />
      </View>
      {m.failed && <Text style={[s.cap, { color: C.danger }]}>Pas envoyé. Vérifie ta connexion.</Text>}
    </View>
  );
}

function Content({ m, mine, onOpen }: { m: ChatItem; mine: boolean; onOpen: (m: ChatItem) => void }) {
  const url = useMediaUrl(m.kind === 'drawing' || m.kind === 'gif' ? m.media_id : undefined);
  if (m.kind === 'sticker') return <Sticker code={m.sticker_code ?? 'swag/star'} size={92} />;
  if (m.kind === 'drawing' || m.kind === 'gif') {
    return (
      <Pressable accessibilityRole="button"
        disabled={m.kind !== 'drawing'}
        onPress={() => onOpen(m)}
        accessibilityLabel={m.kind === 'drawing' ? 'Voir le dessin en grand' : 'GIF'}
        style={{ backgroundColor: C.surface, borderRadius: 24, padding: 8, ...shadowCard }}
      >
        {url ? (
          <Image source={{ uri: url }} style={{ width: 230, height: m.kind === 'gif' ? 160 : 126, borderRadius: 16 }} resizeMode="cover" />
        ) : (
          <View style={{ width: 230, height: 126, borderRadius: 16, backgroundColor: C.background }} />
        )}
        {m.kind === 'drawing' && <Text style={[s.cap, { paddingTop: 6, paddingHorizontal: 4 }]}>{clockTime(m.created_at)} · Touche pour voir en grand</Text>}
      </Pressable>
    );
  }
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 24, maxWidth: 280, backgroundColor: mine ? C.primary : C.surface, ...shadowCard }}>
      <Text style={[s.body, { color: mine ? '#fff' : C.ink }]}>{m.body}</Text>
      <Text style={[s.cap, { color: mine ? '#E9E4FF' : C.inkSoft, textAlign: 'right', marginTop: 2 }]}>{m.pending ? 'Envoi…' : clockTime(m.created_at)}</Text>
    </View>
  );
}

/** P4: the drawing in big, with sticker reactions sent back to the family chat. */
function DrawingViewer({ m, f, onClose }: { m: ChatItem | null; f: Family; onClose: () => void }) {
  const url = useMediaUrl(m?.media_id);
  const insets = useSafeAreaInsets();
  if (!m) return null;
  const kids = speakersOf(m, f);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[s.row, { padding: 16 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={22} stroke={2.6} />
          </Pressable>
          <View>
            <Text style={s.h3}>Dessin de {kids.length ? speakerLabel(kids.map((k) => k.display_name)) : 'la famille'}</Text>
            <Text style={s.cap}>{clockTime(m.created_at)}</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
          <View style={[s.card, { padding: 12 }]}>
            {url && <Image source={{ uri: url }} style={{ width: 330, height: 180, borderRadius: 18 }} resizeMode="contain" />}
          </View>
        </View>
        <Text style={[s.cap, { textAlign: 'center' }]}>Réagir avec un autocollant</Text>
        <View style={[s.row, { justifyContent: 'center', padding: 8 }]}>
          {['swag/heart', 'swag/star', 'swag/ok', 'swag/sun'].map((code) => (
            <Pressable accessibilityRole="button" key={code} accessibilityLabel="Réagir" onPress={() => (void f.send({ kind: 'sticker', sticker_code: code }), onClose())} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
              <Sticker code={code} size={38} />
            </Pressable>
          ))}
        </View>
        <View style={{ padding: 16 }}>
          <Button label="Répondre dans le chat" icon="chat" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const GIF_TOPICS = ['Bravo', 'Rigolo', 'Câlin', 'Fête'];

function GifPanel({ onPick }: { onPick: (gifRef: string) => void }) {
  const [topic, setTopic] = useState(GIF_TOPICS[0]!);
  const [state, setState] = useState<{ topic: string; result?: GifSearchResult; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .searchGifs(topic)
      .then((result) => alive && setState({ topic, result }))
      .catch((err: unknown) => {
        if (!alive) return;
        setState({ topic, error: err instanceof SwagApiError && err.status === 503 ? 'GIF indisponibles pour le moment.' : 'Pas de connexion.' });
      });
    return () => {
      alive = false;
    };
  }, [topic]);
  const current = state?.topic === topic ? state : null;

  return (
    <View style={{ backgroundColor: C.surface, padding: 12, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...shadowCard }}>
      <View style={[s.row, { gap: 6 }]}>
        {GIF_TOPICS.map((t) => (
          <Pressable accessibilityRole="button" key={t} onPress={() => setTopic(t)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: t === topic ? C.primarySoft : C.background, borderWidth: t === topic ? 2 : 0, borderColor: C.primary }}>
            <Text style={{ fontFamily: F.b700, fontSize: 13, color: t === topic ? C.primaryDeep : C.ink }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }} style={{ maxHeight: 92 }}>
        {current?.error && <Text style={s.cap}>{current.error}</Text>}
        {current?.result?.items.slice(0, 12).map((g) => (
          <Pressable accessibilityRole="button" key={g.gif_ref} onPress={() => onPick(g.gif_ref)} accessibilityLabel={`Envoyer le GIF ${g.title}`}>
            <Image source={{ uri: api.absolute(g.preview_path) }} style={{ width: 112, height: 84, borderRadius: 16, backgroundColor: C.background }} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={[s.row, { gap: 6 }]}>
        <Icon name="globe" size={14} color={C.inkSoft} />
        <Text style={s.cap}>Recherche filtrée : GIF adaptés aux enfants</Text>
      </View>
    </View>
  );
}
