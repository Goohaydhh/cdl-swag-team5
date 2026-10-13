import type { DeviceProfilesDto } from '@swag/client';
import {
  type Availability,
  type ChildStatus,
  type ClientToServerEvents,
  type Message,
  type RingerMode,
  RT_NAMESPACE,
  type ServerToClientEvents,
} from '@swag/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { enqueue, flush, onOutboxChange, pending } from './outbox';
import { api, DeviceRevokedError, getAccessToken } from './session';
import { load, save } from './storage';

export type Kid = DeviceProfilesDto['children'][number];
export type Parent = {
  id: string;
  display_name: string;
  availability: Availability;
  eta_minutes: number | null;
  /** When the availability (and so the ETA countdown) was set. */
  availability_at: string | null;
  ringer: RingerMode;
};
export interface StatusInfo { status: ChildStatus; occurred_at: string }
/** A message on screen: confirmed by the server, or still in the outbox. */
export type ChatItem = Message & { pending?: boolean };

const WHO_KEY = 'swag.who';
const newId = () => crypto.randomUUID();

/** Everything a paired tablet shows, kept live by the socket. */
export function useTablet(onRevoked: () => void) {
  const [family, setFamily] = useState<{ name: string } | null>(null);
  const [kids, setKids] = useState<Kid[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StatusInfo | null>>({});
  const [who, setWhoState] = useState<string[]>(() => load<string[]>(WHO_KEY, []));
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [readUpTo, setReadUpTo] = useState<{ id: string; by: string } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [outboxSize, setOutboxSize] = useState(pending().length);
  const [unread, setUnread] = useState(0);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const chatOpen = useRef(false);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof DeviceRevokedError) onRevoked();
      else console.warn(err);
    },
    [onRevoked],
  );

  const setWho = useCallback((ids: string[]) => {
    setWhoState(ids);
    save(WHO_KEY, ids);
  }, []);

  const loadProfiles = useCallback(async () => {
    const p = await api.deviceProfiles();
    setFamily(p.family);
    setKids(p.children);
    setParents(p.parents);
    setStatuses(Object.fromEntries(p.children.map((c) => [c.id, c.status])));
    // Keep the chips valid: by default every child of the tablet speaks.
    setWhoState((prev) => {
      const valid = prev.filter((id) => p.children.some((c) => c.id === id));
      const next = valid.length ? valid : p.children.map((c) => c.id);
      save(WHO_KEY, next);
      return next;
    });
  }, []);

  const loadChat = useCallback(async () => {
    const chat = await api.familyChat();
    setConversationId(chat.id);
    setUnread(chat.unread_count);
    const page = await api.messages(chat.id, undefined, 50);
    setMessages((prev) => {
      const server = [...page.items].reverse();
      const known = new Set(server.map((m) => m.client_msg_id).filter(Boolean));
      return [...server, ...prev.filter((m) => m.pending && !known.has(m.client_msg_id))];
    });
  }, []);

  // ---------------------------------------------------------------- live connection
  useEffect(() => {
    let disposed = false;
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

    (async () => {
      try {
        await loadProfiles();
        await loadChat();
        const token = await getAccessToken();
        if (disposed) return;
        socket = io(`${API_URL}${RT_NAMESPACE}`, {
          auth: (cb) => {
            getAccessToken().then((t) => cb({ token: t }), () => cb({ token }));
          },
          transports: ['websocket'],
        });
        socketRef.current = socket;
        socket.on('connect', () => {
          setOnline(true);
          void flush();
          void loadProfiles().catch(fail);
          void loadChat().catch(fail);
        });
        socket.on('disconnect', () => setOnline(false));
        socket.on('status_updated', ({ data }) =>
          setStatuses((s) => ({ ...s, [data.child_id]: { status: data.status, occurred_at: data.occurred_at } })),
        );
        socket.on('availability_updated', ({ data }) =>
          setParents((ps) =>
            ps.map((p) =>
              p.id === data.user_id
                ? { ...p, availability: data.status, eta_minutes: data.eta_minutes ?? null, availability_at: data.updated_at }
                : p,
            ),
          ),
        );
        socket.on('ringer_updated', ({ data }) =>
          setParents((ps) => ps.map((p) => (p.id === data.user_id ? { ...p, ringer: data.mode } : p))),
        );
        socket.on('chat_message_created', ({ data }) => {
          setMessages((ms) => {
            if (ms.some((m) => m.id === data.message.id)) return ms;
            const rest = ms.filter((m) => !(m.pending && m.client_msg_id && m.client_msg_id === data.message.client_msg_id));
            return [...rest, data.message];
          });
          if (data.message.sender.type === 'user') {
            setTyping(null);
            if (!chatOpen.current) setUnread((u) => u + 1);
          }
        });
        socket.on('chat_typing', ({ data }) => {
          if (data.member.type !== 'user') return;
          setTyping(data.typing ? data.member.id : null);
        });
        socket.on('chat_read', ({ data }) => {
          if (data.member.type === 'user') setReadUpTo({ id: data.up_to_message_id, by: data.member.id });
        });
        socket.on('profiles_changed', () => void loadProfiles().catch(fail));
        socket.on('device_revoked', () => onRevoked());
        socket.on('auth_expiring', async () => {
          try {
            const fresh = await getAccessToken(true);
            socket?.emit('reauth', { token: fresh }, () => undefined);
          } catch (err) {
            fail(err);
          }
        });
      } catch (err) {
        fail(err);
      }
    })();

    const off = onOutboxChange(() => setOutboxSize(pending().length));
    const retry = setInterval(() => void flush(), 15_000);
    return () => {
      disposed = true;
      off();
      clearInterval(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, [fail, loadChat, loadProfiles, onRevoked]);

  // ---------------------------------------------------------------- actions

  /** One status per checked child (the API records each child separately). */
  const sendStatus = useCallback(
    (status: ChildStatus) => {
      const at = new Date().toISOString();
      setStatuses((s) => ({ ...s, ...Object.fromEntries(who.map((id) => [id, { status, occurred_at: at }])) }));
      for (const childId of who) {
        void enqueue({ kind: 'status', childId, body: { client_event_id: newId(), status, occurred_at: at } });
      }
    },
    [who],
  );

  const sendMessage = useCallback(
    (content: { kind: 'text'; body: string } | { kind: 'sticker'; sticker_code: string } | { kind: 'gif'; gif_ref: string } | { kind: 'drawing'; media_id: string }) => {
      if (!conversationId || !who.length) return;
      const clientMsgId = newId();
      const body = { client_msg_id: clientMsgId, speaker_ids: who, ...content };
      const optimistic: ChatItem = {
        id: `local-${clientMsgId}`,
        conversation_id: conversationId,
        sender: { type: 'child', id: who[0]! },
        speaker_ids: who,
        client_msg_id: clientMsgId,
        created_at: new Date().toISOString(),
        pending: true,
        ...content,
      };
      setMessages((ms) => [...ms, optimistic]);
      void enqueue({ kind: 'message', conversationId, body });
    },
    [conversationId, who],
  );

  /** Marks the chat read for the tablet's children, and clears the badge. */
  const markRead = useCallback(() => {
    const last = [...messages].reverse().find((m) => !m.pending);
    setUnread(0);
    if (!last || !conversationId) return;
    socketRef.current?.emit('chat_read', { conversation_id: conversationId, up_to_message_id: last.id }, () => undefined);
  }, [conversationId, messages]);

  const setChatOpen = useCallback((open: boolean) => {
    chatOpen.current = open;
  }, []);

  const typingParent = typing ? parents.find((p) => p.id === typing) ?? null : null;

  return {
    family,
    kids,
    parents,
    statuses,
    who,
    setWho,
    messages,
    readUpTo,
    typingParent,
    online,
    outboxSize,
    unread,
    sendStatus,
    sendMessage,
    markRead,
    setChatOpen,
  };
}

export type Tablet = ReturnType<typeof useTablet>;
