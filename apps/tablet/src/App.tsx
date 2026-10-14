import { useCallback, useState } from 'react';
import { forgetDevice, loadSession, saveSession, type DeviceSession } from './lib/session';
import { useTablet } from './lib/useTablet';
import { ChatScreen } from './screens/ChatScreen';
import { DrawScreen } from './screens/DrawScreen';
import { Pairing } from './screens/Pairing';
import { StatusScreen } from './screens/StatusScreen';
import { Icon } from './ui/art';

/** The child tablet: pairing until a parent validates it, then status / chat / drawing. */
export default function App() {
  const [session, setSession] = useState<DeviceSession | null>(() => loadSession());

  const paired = useCallback((s: DeviceSession) => {
    saveSession(s);
    setSession(s);
  }, []);
  const revoked = useCallback(() => {
    forgetDevice();
    setSession(null);
  }, []);

  if (!session) return <Pairing onPaired={paired} />;
  return <Paired key={session.deviceId} onRevoked={revoked} />;
}

type Screen = 'status' | 'chat' | 'draw';

function Paired({ onRevoked }: { onRevoked: () => void }) {
  const t = useTablet(onRevoked);
  const [screen, setScreen] = useState<Screen>('status');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="app">
      <div className="sb">
        <span />
        <span className="row" style={{ gap: 8 }}>
          {!t.online && (
            <span className="hint" style={{ padding: '4px 14px', fontSize: 14 }}>
              <Icon name="wifiOff" size={18} />
              Hors ligne
            </span>
          )}
        </span>
      </div>

      {screen === 'status' && <StatusScreen t={t} />}
      {screen === 'chat' && <ChatScreen t={t} onBack={() => setScreen('status')} onDraw={() => setScreen('draw')} />}
      {screen === 'draw' && (
        <DrawScreen
          t={t}
          onBack={() => setScreen('chat')}
          onSent={() => (setScreen('chat'), showToast('Dessin envoyé à toute la famille !'))}
        />
      )}

      {screen === 'status' && (
        <div className="dock">
          <button aria-current="true">
            <Icon name="house" size={32} stroke={2.4} />
            Mon statut
          </button>
          <button onClick={() => setScreen('chat')}>
            <Icon name="chat" size={32} stroke={2.4} />
            Discuter
            {t.unread > 0 && <span className="badge">{t.unread}</span>}
          </button>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
