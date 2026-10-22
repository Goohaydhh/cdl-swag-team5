import { speakerLabel } from '@swag/client';
import { swagStickers } from '@swag/design-tokens';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockTime } from '../lib/format';
import { useKeyboardHeight } from '../lib/useKeyboard';
import { useMediaUrl } from '../lib/media';
import type { ChatItem, Family } from '../lib/useFamily';
import { Gremlin, Icon, kidColor, Sticker } from '../ui/art';
import { Button, GremlinStack, TopBar } from '../ui/kit';
import { C, F, s, shadowCard } from '../ui/theme';
import { DrawScreen } from './DrawScreen';

type Panel = null | 'stickers';

/** P2 "Chat famille" (the only conversation), P4 a drawing in full screen. */
export function ChatScreen({ f }: { f: Family }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState<ChatItem | null>(null);
  const [receipt, setReceipt] = useState<ChatItem | null>(null);
  const [drawing, setDrawing] = useState(false);
  const { markRead, setChatOpen } = f;
  /**
   * Newest first, drawn in an inverted list: the chat then opens on the last message with no
   * scrolling at all. `scrollToEnd` used to land a few messages short, because a virtualised
   * list only estimates the height of the rows it has not measured yet (bug report, 21/10/2026).
   */
  const newestFirst = useMemo(() => [...f.messages].reverse(), [f.messages]);
  const kids = f.overview?.children ?? [];
  // The tab bar carries the navigation-bar inset, but it hides while typing — so the composer
  // has to carry it then, or the translucent system bar sits over the text (test, 22/10/2026).
  const composerInsets = useSafeAreaInsets();
  // Validated on the device, 22/10/2026: the activity is in `adjustResize` so the top bar stays
  // put while typing, and this padding is what puts the composer clear of the keyboard.
  const keyboard = useKeyboardHeight();
  const keyboardOpen = keyboard > 0;

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
    // Nothing here compensates for the keyboard: the activity is in `adjustPan`, so Android
    // itself keeps the focused field on screen. Measuring it from JS under edge-to-edge gave a
    // height that was always short, and the box stayed partly covered (test, 22/10/2026).
    <View style={{ flex: 1, paddingBottom: keyboard }}>
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
        data={newestFirst}
        // Only when there is something to show: an inverted empty state renders upside down.
        inverted={newestFirst.length > 0}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 10, paddingTop: 60 }}>
            <Gremlin color={C.primary} size={96} />
            <Text style={s.h2}>Dis bonjour à ta famille !</Text>
            <Text style={[s.cap, { textAlign: 'center' }]}>Les messages, dessins et autocollants des enfants arrivent ici.</Text>
          </View>
        }
        // Inverted: the header sits at the visual bottom, just under the newest message.
        ListHeaderComponent={
          typingNames.length ? <Text style={[s.cap, { marginBottom: 8 }]}>{speakerLabel(typingNames)} écrit…</Text> : null
        }
        renderItem={({ item }) => <MessageRow m={item} f={f} onOpen={setViewing} onReceipt={setReceipt} />}
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

      <View
        style={[
          s.row,
          { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 + (keyboardOpen ? composerInsets.bottom : 0), backgroundColor: C.surface, gap: 8 },
        ]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Autocollants" onPress={() => setPanel(panel === 'stickers' ? null : 'stickers')} style={pill(panel === 'stickers')}>
          <Icon name="smile" size={24} color={panel === 'stickers' ? '#fff' : C.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dessiner" onPress={() => setDrawing(true)} style={pill(false)}>
          <Icon name="brush" size={22} color={C.primary} stroke={2.4} />
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
      <ReadReceipt m={receipt} f={f} onClose={() => setReceipt(null)} />
      <DrawScreen visible={drawing} f={f} onClose={() => setDrawing(false)} onSent={() => setDrawing(false)} />
    </View>
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

function MessageRow({ m, f, onOpen, onReceipt }: { m: ChatItem; f: Family; onOpen: (m: ChatItem) => void; onReceipt: (m: ChatItem) => void }) {
  const mine = m.sender.type === 'user' && m.sender.id === f.me;
  const kids = speakersOf(m, f);
  const otherParent = m.sender.type === 'user' && !mine ? f.overview?.parents.find((p) => p.id === m.sender.id) : null;
  const who = kids.length ? `${speakerLabel(kids.map((k) => k.display_name))}${kids.length > 1 ? ' · message commun' : ''}` : (otherParent?.display_name ?? '');
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {/* The avatar sits next to the sender's name rather than beside the bubble, so you read
          who is speaking in one glance (test feedback, 22/10/2026). */}
      {!mine && who ? (
        <View style={[s.row, { gap: 8, marginBottom: 3 }]}>
          {kids.length > 0 && <GremlinStack colors={kids.slice(0, 3).map(kidColor)} size={kids.length > 1 ? 26 : 32} />}
          <Text style={s.cap}>{who}</Text>
        </View>
      ) : null}
      <View style={[s.row, { gap: 8, alignItems: 'flex-end' }]}>
        <Content m={m} mine={mine} onOpen={onOpen} />
        {m.kind === 'text' && kids.length > 0 && !!m.body && <ListenButton id={m.id} text={m.body} />}
      </View>
      {mine && !m.failed && <Receipt m={m} f={f} onPress={() => onReceipt(m)} />}
      {m.failed && <Text style={[s.cap, { color: C.danger }]}>Pas envoyé. Vérifie ta connexion.</Text>}
    </View>
  );
}

/** A member has read a message when their marker reaches it (UUIDv7 sorts by time). */
function hasRead(readers: Record<string, string>, type: string, id: string, messageId: string) {
  const upTo = readers[`${type}:${id}`];
  return !!upTo && upTo >= messageId;
}

/** Everyone the message was for, and whether they have read it. */
function readersOf(m: ChatItem, f: Family) {
  const rows: { key: string; name: string; read: boolean }[] = [];
  for (const c of f.overview?.children ?? []) rows.push({ key: `c${c.id}`, name: c.display_name, read: hasRead(f.readers, 'child', c.id, m.id) });
  for (const p of f.overview?.parents ?? []) {
    if (p.id !== f.me) rows.push({ key: `p${p.id}`, name: p.display_name, read: hasRead(f.readers, 'user', p.id, m.id) });
  }
  return rows;
}

/** One tick once the message is sent, two once someone has read it. */
function Ticks({ read }: { read: boolean }) {
  const color = read ? C.primary : C.inkSoft;
  return (
    <View style={{ flexDirection: 'row' }}>
      <Icon name="check" size={14} color={color} stroke={2.8} />
      {read && (
        <View style={{ marginLeft: -7 }}>
          <Icon name="check" size={14} color={color} stroke={2.8} />
        </View>
      )}
    </View>
  );
}

function Receipt({ m, f, onPress }: { m: ChatItem; f: Family; onPress: () => void }) {
  const read = !m.pending && readersOf(m, f).some((r) => r.read);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Voir qui a lu ce message"
      onPress={onPress}
      disabled={m.pending}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 3, paddingHorizontal: 4 }}
    >
      {m.pending ? <Icon name="clock" size={14} color={C.inkSoft} stroke={2.6} /> : <Ticks read={read} />}
      <Text style={[s.cap, read ? { color: C.primary } : null]}>{m.pending ? 'Envoi…' : read ? 'Lu' : 'Envoyé'}</Text>
    </Pressable>
  );
}

/** Tapping a sent message says who has read it and who has not. */
function ReadReceipt({ m, f, onClose }: { m: ChatItem | null; f: Family; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!m) return null;
  const rows = readersOf(m, f);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(42,27,77,0.45)' }} onPress={onClose}>
        <Pressable style={[s.card, { margin: 12, marginBottom: 12 + insets.bottom, padding: 20, gap: 12 }]} onPress={() => undefined}>
          <Text style={s.h3}>Qui a lu ce message ?</Text>
          {rows.length === 0 && <Text style={s.cap}>Personne d’autre dans la famille pour l’instant.</Text>}
          {rows.map((r) => (
            <View key={r.key} style={[s.row, { gap: 10 }]}>
              <Text style={[s.strong, s.grow]}>{r.name}</Text>
              <Ticks read={r.read} />
              <Text style={[s.cap, r.read ? { color: C.primary } : null]}>{r.read ? 'Lu' : 'Pas encore lu'}</Text>
            </View>
          ))}
          <Button label="Fermer" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
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

/** Which message is being read aloud (one at a time). */
let speakingId: string | null = null;

/** Reads a child's message aloud (children may write phonetically); a second press stops it. */
function ListenButton({ id, text }: { id: string; text: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => {
    if (speakingId === id) {
      void Speech.stop();
      speakingId = null;
    }
  }, [id]);
  const press = () => {
    void Speech.stop();
    if (speakingId === id) {
      speakingId = null;
      setOn(false);
      return;
    }
    speakingId = id;
    setOn(true);
    const done = () => {
      if (speakingId === id) speakingId = null;
      setOn(false);
    };
    Speech.speak(text, { language: 'fr-FR', onDone: done, onStopped: done, onError: done });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? 'Arrêter la lecture' : 'Écouter le message'}
      onPress={press}
      hitSlop={8}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primary : C.primarySoft }}
    >
      <Icon name="volume" size={20} color={on ? '#fff' : C.primary} />
    </Pressable>
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
