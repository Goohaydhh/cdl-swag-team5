import type { DeviceDto, FamilyDto, OverviewDto } from '@swag/client';
import {
  type ClientToServerEvents,
  type Message,
  type PairingState,
  type RingerMode,
  RT_NAMESPACE,
  type ServerToClientEvents,
} from '@swag/protocol';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { addRingerListener, getRingerMode, ringerSupported } from '../../modules/ringer-mode';
import { updateStatusWidget } from '../../modules/status-widget';
import { API_URL } from './config';
import { registerPush, toWidgetChildren } from './push';
import { accessToken, api, getSession } from './session';

export type ChatItem = Message & { pending?: boolean; failed?: boolean };
export interface PairingEvent { pairing_id: string; state: PairingState; device_info: Record<string, unknown> }

/** The family as the parent app shows it, kept live by the socket. */
export function useFamily() {
  const [family, setFamily] = useState<FamilyDto | null>(null);
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [typingKids, setTypingKids] = useState<string[]>([]);
  const [online, setOnline] = useState(false);
  const [pairing, setPairing] = useState<PairingEvent | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const chatOpen = useRef(false);
  const me = getSession()?.user.id;

  const reload = useCallback(async () => {
    const [f, o, d] = await Promise.all([api.family(), api.overview(), api.devices()]);
    setFamily(f);
    setOverview(o);
    setDevices(d);
    const chat = await api.familyChat();
    setConversationId(chat.id);
    setUnread(chatOpen.current ? 0 : chat.unread_count);
    const page = await api.messages(chat.id, undefined, 50);
    setMessages((prev) => {
      const server = [...page.items].reverse();
      const known = new Set(server.map((m) => m.client_msg_id));
      return [...server, ...prev.filter((m) => m.pending && !known.has(m.client_msg_id))];
    });
  }, []);

  useEffect(() => {
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    void reload().catch((e) => console.warn(e));

    socket = io(`${API_URL}${RT_NAMESPACE}`, {
      auth: (cb) => void accessToken().then((token) => cb({ token })),
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // FR-13: tell the family when my phone is on silent or vibrate. Android builds only.
    let lastRinger: RingerMode | null = null;
    const reportRinger = (force = false) => {
      if (!ringerSupported || !socket?.connected) return;
      const mode = getRingerMode();
      if (!force && mode === lastRinger) return;
      lastRinger = mode;
      socket.emit('ringer_status', { mode, changed_at: new Date().toISOString() }, () => undefined);
    };
    const ringerSub = addRingerListener(() => reportRinger());

    socket.on('connect', () => {
      setOnline(true);
      reportRinger(true);
      void reload().catch(() => undefined);
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on('status_updated', ({ data }) =>
      setOverview((o) =>
        o && {
          ...o,
          children: o.children.map((c) =>
            c.id === data.child_id ? { ...c, status: { status: data.status, event_id: data.event_id, occurred_at: data.occurred_at } } : c,
          ),
        },
      ),
    );
    socket.on('availability_updated', ({ data }) =>
      setOverview((o) =>
        o && {
          ...o,
          parents: o.parents.map((p) =>
            p.id === data.user_id
              ? { ...p, availability: data.status, eta_minutes: data.eta_minutes ?? null, availability_at: data.updated_at }
              : p,
          ),
        },
      ),
    );
    socket.on('ringer_updated', ({ data }) =>
      setOverview((o) => o && { ...o, parents: o.parents.map((p) => (p.id === data.user_id ? { ...p, ringer: data.mode } : p)) }),
    );
    socket.on('chat_message_created', ({ data }) => {
      setMessages((ms) => {
        if (ms.some((m) => m.id === data.message.id)) return ms;
        const rest = ms.filter((m) => !(m.pending && m.client_msg_id === data.message.client_msg_id));
        return [...rest, data.message];
      });
      if (data.message.sender.id !== me) {
        setTypingKids([]);
        if (!chatOpen.current) setUnread((u) => u + 1);
      }
    });
    socket.on('chat_typing', ({ data }) => {
      if (data.member.type !== 'child') return;
      setTypingKids(data.typing ? (data.speaker_ids ?? [data.member.id]) : []);
    });
    socket.on('profiles_changed', () => void reload().catch(() => undefined));
    socket.on('pairing_updated', ({ data }) => {
      setPairing(data);
      void api.devices().then(setDevices).catch(() => undefined);
    });
    socket.on('auth_expiring', async () => {
      const token = await accessToken();
      if (token) socket?.emit('reauth', { token }, () => undefined);
    });

    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      reportRinger();
      void reload().catch(() => undefined);
    });
    return () => {
      sub.remove();
      ringerSub?.remove();
      socket?.close();
      socketRef.current = null;
    };
  }, [me, reload]);

  // Keep the Android home-screen widget in step with the live overview (pushes cover the app being closed).
  useEffect(() => {
    if (overview) updateStatusWidget(toWidgetChildren(overview));
  }, [overview]);

  useEffect(() => {
    const sub = registerPush();
    return () => void sub.then((s) => s?.remove());
  }, []);

  const send = useCallback(
    async (content: { kind: 'text'; body: string } | { kind: 'sticker'; sticker_code: string } | { kind: 'gif'; gif_ref: string }) => {
      if (!conversationId || !me) return;
      const clientMsgId = randomUUID();
      const optimistic: ChatItem = {
        id: `local-${clientMsgId}`,
        conversation_id: conversationId,
        sender: { type: 'user', id: me },
        speaker_ids: [],
        client_msg_id: clientMsgId,
        created_at: new Date().toISOString(),
        pending: true,
        ...content,
      };
      setMessages((ms) => [...ms, optimistic]);
      try {
        const res = await api.sendMessage(conversationId, { client_msg_id: clientMsgId, ...content });
        setMessages((ms) => {
          const without = ms.filter((m) => m.client_msg_id !== clientMsgId || m.id === res.message.id);
          return without.some((m) => m.id === res.message.id) ? without : [...without, res.message];
        });
      } catch {
        setMessages((ms) => ms.map((m) => (m.client_msg_id === clientMsgId ? { ...m, pending: false, failed: true } : m)));
      }
    },
    [conversationId, me],
  );

  const markRead = useCallback(() => {
    setUnread(0);
    const last = [...messages].reverse().find((m) => !m.pending && !m.failed);
    if (last && conversationId) socketRef.current?.emit('chat_read', { conversation_id: conversationId, up_to_message_id: last.id }, () => undefined);
  }, [conversationId, messages]);

  const setChatOpen = useCallback((open: boolean) => {
    chatOpen.current = open;
  }, []);

  const clearPairing = useCallback(() => setPairing(null), []);

  const typing = useCallback(
    (on: boolean) => {
      if (conversationId) socketRef.current?.emit('chat_typing', { conversation_id: conversationId, typing: on });
    },
    [conversationId],
  );

  return {
    me,
    family,
    overview,
    devices,
    messages,
    unread,
    typingKids,
    online,
    pairing,
    clearPairing,
    reload,
    send,
    markRead,
    setChatOpen,
    typing,
    setOverview,
  };
}

export type Family = ReturnType<typeof useFamily>;
