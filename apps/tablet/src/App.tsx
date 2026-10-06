import { statusColor } from '@swag/design-tokens';
import {
  type AckResult,
  type ChildStatus,
  type ClientToServerEvents,
  RT_NAMESPACE,
  type ServerToClientEvents,
} from '@swag/protocol';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import './App.css';

// Sprint 0 status board: proves the tablet -> API -> family round trip.
// Sprint 2 adds the SQLite outbox, profile picker and real child session tokens.

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3100';
const familyId = import.meta.env.VITE_DEV_FAMILY_ID ?? '00000000-0000-4000-8000-000000000001';
const childId = import.meta.env.VITE_DEV_CHILD_ID ?? '00000000-0000-4000-8000-000000000002';

const buttons: { status: ChildStatus; label: string; icon: string }[] = [
  { status: 'at_home', label: 'At home', icon: '🏠' },
  { status: 'left_home', label: 'Left home', icon: '🚶' },
  { status: 'at_friend', label: "At a friend's", icon: '🧒' },
];

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

export default function App() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [current, setCurrent] = useState<ChildStatus | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
      `${apiUrl}${RT_NAMESPACE}`,
      { auth: { token: `dev:${familyId}:child:${childId}` } },
    );
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    return () => {
      socket.close();
    };
  }, []);

  function send(status: ChildStatus) {
    setCurrent(status);
    setSendState('sending');
    socketRef.current?.emit(
      'status_update',
      {
        client_event_id: crypto.randomUUID(),
        child_id: childId,
        status,
        occurred_at: new Date().toISOString(),
      },
      (ack: AckResult<{ event_id: string }>) => setSendState(ack.ok ? 'sent' : 'failed'),
    );
  }

  return (
    <main className="board">
      <header className="board__header">
        <h1>Where are you?</h1>
        <span className={connected ? 'dot dot--on' : 'dot'} aria-label={connected ? 'online' : 'offline'} />
      </header>
      <div className="board__buttons">
        {buttons.map((b) => (
          <button
            key={b.status}
            className={current === b.status ? 'status-btn status-btn--active' : 'status-btn'}
            style={{ '--status-color': statusColor[b.status] } as React.CSSProperties}
            onClick={() => send(b.status)}
            disabled={!connected}
          >
            <span className="status-btn__icon" aria-hidden>
              {b.icon}
            </span>
            {b.label}
          </button>
        ))}
      </div>
      <p className="board__feedback" role="status">
        {sendState === 'sending' && 'Sending…'}
        {sendState === 'sent' && 'Sent to your parents ✓'}
        {sendState === 'failed' && 'Not sent, try again'}
      </p>
    </main>
  );
}
