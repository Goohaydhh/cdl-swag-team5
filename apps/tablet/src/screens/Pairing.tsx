import { CODE_ALPHABET, formatCode, SwagApiError } from '@swag/client';
import { parsePairingQr } from '@swag/protocol';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceInfo } from '../lib/config';
import { anonymous, type DeviceSession } from '../lib/session';
import { Gremlin, Icon } from '../ui/art';

type Step = { name: 'scan' } | { name: 'code' } | { name: 'wait'; pairingId: string; secret: string; family: string; code: string };

/**
 * K1-K3: the tablet scans the parent's QR code (or types the code), then waits for the
 * parent to validate it in the parent app.
 */
export function Pairing({ onPaired }: { onPaired: (s: DeviceSession) => void }) {
  const [step, setStep] = useState<Step>({ name: 'scan' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = useCallback(async (code: string, pairingId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await anonymous.joinPairing(code, pairingId, deviceInfo());
      setStep({ name: 'wait', pairingId: res.pairing_id, secret: res.poll_secret, family: res.family.name, code: formatCode(code) });
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="app">
      <div className="sb">
        {step.name === 'scan' ? (
          <span className="hint" style={{ padding: '4px 16px', fontSize: 14 }}>
            <Icon name="phone" size={18} />
            Dans l’app parent : Famille puis Associer une tablette
          </span>
        ) : (
          <span />
        )}
        <Icon name="battery" size={22} stroke={2} />
      </div>
      {step.name === 'scan' && <Scan busy={busy} error={error} onCode={join} onType={() => (setError(null), setStep({ name: 'code' }))} />}
      {step.name === 'code' && <TypeCode busy={busy} error={error} onBack={() => (setError(null), setStep({ name: 'scan' }))} onCode={(c) => join(c)} />}
      {step.name === 'wait' && <Wait step={step} onPaired={onPaired} onRestart={() => setStep({ name: 'scan' })} />}
    </div>
  );
}

function explain(err: unknown): string {
  if (err instanceof SwagApiError) {
    if (err.status === 0) return 'Pas de connexion. Vérifie le Wi-Fi de la tablette.';
    if (err.code === 'PAIRING_EXPIRED') return 'Ce code a expiré. Demande un nouveau code à ton parent.';
    if (err.code === 'PAIRING_LOCKED') return 'Trop d’essais. Ton parent doit générer un nouveau code.';
    if (err.code === 'PAIRING_NOT_FOUND') return 'Ce code ne marche pas. Vérifie-le avec ton parent.';
    if (err.code === 'VALIDATION') return 'Le code a 8 caractères, comme K7QF-9M2D.';
  }
  return 'Oups, ça n’a pas marché. Réessaie.';
}

// ---------------------------------------------------------------- K1 scan

function Scan({ busy, error, onCode, onType }: { busy: boolean; error: string | null; onCode: (code: string, pairingId?: string) => void; onType: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'off' | 'on' | 'denied'>('off');
  const found = useRef(false);

  useEffect(() => {
    if (camera !== 'on') return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    const handle = (text: string | undefined) => {
      const qr = text ? parsePairingQr(text) : null;
      if (qr && !found.current) {
        found.current = true;
        onCode(qr.code, qr.pairing_id);
      }
    };

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video || video.readyState < 2) {
        if (!stopped) raf = requestAnimationFrame(tick);
        return;
      }
      try {
        if (detector) {
          const codes = await detector.detect(video);
          handle(codes[0]?.rawValue);
        } else if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          handle(jsQR(img.data, img.width, img.height)?.data);
        }
      } catch {
        // A frame that cannot be read: try the next one.
      }
      if (!stopped && !found.current) setTimeout(() => (raf = requestAnimationFrame(tick)), 200);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setCamera('denied'));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, onCode]);

  useEffect(() => {
    if (error) found.current = false; // let the child try again
  }, [error]);

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 72, padding: '0 80px' }}>
      <div className="scanbox">
        {camera === 'on' ? (
          <video ref={videoRef} muted playsInline aria-label="Caméra" />
        ) : (
          <div style={{ color: '#CFC6EE', font: '600 22px var(--font-b)', textAlign: 'center', padding: '0 60px' }}>
            {camera === 'denied' ? 'La caméra n’est pas disponible. Tape le code à la place.' : 'Touche Scanner pour allumer la caméra'}
          </div>
        )}
        <svg className="corners" viewBox="0 0 520 520" fill="none" stroke="#FFC933" strokeWidth={10} strokeLinecap="round" aria-hidden="true">
          <path d="M40 110V70a30 30 0 0 1 30-30h40" />
          <path d="M410 40h40a30 30 0 0 1 30 30v40" />
          <path d="M480 410v40a30 30 0 0 1-30 30h-40" />
          <path d="M110 480H70a30 30 0 0 1-30-30v-40" />
        </svg>
        {camera === 'on' && <i className="scanl" />}
      </div>
      <div className="col" style={{ gap: 22, alignItems: 'flex-start' }}>
        <Gremlin color="#6B4EFF" size={96} />
        <h1 className="big" style={{ maxWidth: 560 }}>Scanne le QR code de ton parent</h1>
        {['Ouvre SWAG sur le téléphone d’un parent', 'Va dans Famille, puis Associer une tablette', 'Montre son QR code à la caméra'].map((s, i) => (
          <div className="row" style={{ gap: 16 }} key={s}>
            <span className="stepnum">{i + 1}</span>
            <span style={{ font: '600 24px var(--font-b)', maxWidth: 440 }}>{s}</span>
          </div>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ gap: 16 }}>
          <button className="bigbtn" disabled={busy} onClick={() => setCamera('on')}>
            <Icon name="camera" size={32} color="#fff" stroke={2.4} />
            {busy ? 'Un instant…' : 'Scanner'}
          </button>
          <button className="bigbtn white" onClick={onType}>
            <Icon name="keyboard" size={32} stroke={2.4} />
            Je tape le code
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- K2 type the code

function TypeCode({ busy, error, onBack, onCode }: { busy: boolean; error: string | null; onBack: () => void; onCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const add = (c: string) => setCode((s) => (s.length < 8 ? s + c : s));
  return (
    <>
      <div className="row" style={{ padding: '20px 32px', gap: 16 }}>
        <button className="iconbtn" onClick={onBack} aria-label="Retour">
          <Icon name="left" size={32} stroke={2.6} />
        </button>
        <h1 className="h1">Tape le code de ton parent</h1>
      </div>
      <div className="col" style={{ flex: 1, alignItems: 'center', gap: 18 }}>
        <div className="row" style={{ gap: 12 }} aria-label={`Code saisi : ${code || 'vide'}`}>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i === 4 && <span className="big" style={{ color: 'var(--a-soft)' }}>–</span>}
              <span className={`slotk ${i === code.length ? 'on' : ''}`}>{code[i] ?? ''}</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: 790, justifyContent: 'center' }}>
          {CODE_ALPHABET.split('').map((c) => (
            <button key={c} className="keyk" onClick={() => add(c)} aria-label={c}>
              {c}
            </button>
          ))}
        </div>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div className="row" style={{ gap: 16 }}>
          <button className="bigbtn white" onClick={() => setCode((s) => s.slice(0, -1))}>
            <Icon name="del" size={32} stroke={2.4} />
            Effacer
          </button>
          <button className="bigbtn" disabled={code.length !== 8 || busy} onClick={() => onCode(code)}>
            <Icon name="check" size={32} color="#fff" stroke={2.6} />
            {busy ? 'Un instant…' : 'Valider'}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- K3 wait for the parent

function Wait({ step, onPaired, onRestart }: { step: Extract<Step, { name: 'wait' }>; onPaired: (s: DeviceSession) => void; onRestart: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const alive = () => !abort.signal.aborted;
    (async () => {
      while (alive()) {
        try {
          const res = await anonymous.pollPairing(step.pairingId, step.secret, 25, abort.signal);
          if (!alive()) return;
          if (res.state === 'approved') {
            // Exchange right away: the first credential is single-use and rotates.
            const token = await anonymous.deviceToken(res.device_id, res.credential);
            onPaired({ deviceId: res.device_id, credential: token.credential, familyName: res.family.name });
            return;
          }
          if (res.state === 'rejected') return setMessage('Ton parent a refusé l’association.');
          if (res.state === 'expired' || res.state === 'consumed') return setMessage('Le code a expiré. Recommence avec un nouveau code.');
        } catch (err) {
          if (!alive()) return;
          if (err instanceof SwagApiError && err.status === 404) return setMessage('Le code a expiré. Recommence avec un nouveau code.');
          await new Promise((r) => setTimeout(r, 3000)); // offline: keep waiting
        }
      }
    })();
    return () => abort.abort();
  }, [step, onPaired]);

  return (
    <div className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center' }}>
      <div style={{ width: 240, height: 240, borderRadius: '50%', background: 'var(--a-primary-soft)', display: 'grid', placeItems: 'center' }}>
        <Gremlin color="#6B4EFF" size={150} />
      </div>
      {message ? (
        <h1 className="big">{message}</h1>
      ) : (
        <>
          <h1 className="big">On attend ton parent…</h1>
          <p className="lead">Il doit valider l’association sur son téléphone.</p>
          <div className="dots" aria-hidden="true"><i /><i /><i /></div>
        </>
      )}
      <div className="row card" style={{ padding: '14px 24px', gap: 16, borderRadius: 28, boxShadow: 'inset 0 0 0 2px var(--a-line)' }}>
        <Icon name="tablet" size={40} color="var(--a-primary)" />
        <div style={{ textAlign: 'left' }}>
          <div className="h3">{deviceInfo().model}</div>
          <div className="cap">{step.family} · code {step.code}</div>
        </div>
      </div>
      <button className="bigbtn white" onClick={onRestart}>
        <Icon name="refresh" size={32} stroke={2.4} />
        Recommencer
      </button>
    </div>
  );
}
