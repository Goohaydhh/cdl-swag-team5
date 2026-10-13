import { AVATAR_CATEGORIES, DEFAULT_AVATAR, randomAvatar, suggestFromFace, withPart } from '@swag/avatar';
import type { AvatarSpec } from '@swag/protocol';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Kid, Tablet } from '../lib/useTablet';
import { Icon } from '../ui/art';
import { AvatarPic, KidPic } from '../ui/AvatarPic';

const CATEGORIES = AVATAR_CATEGORIES.filter((c) => !c.parentOnly);

/** "Créer mon avatar": pick the child, optional camera scan (if a parent allowed it), then customise. */
export function AvatarScreen({ t, onBack, onSaved }: { t: Tablet; onBack: () => void; onSaved: () => void }) {
  // A single child on this tablet: no need to ask who it is.
  const only = t.kids.length === 1 ? t.kids[0] : undefined;
  const [kid, setKid] = useState<Kid | null>(only ?? null);
  const [step, setStep] = useState<'camera' | 'build'>(only?.avatar_camera_allowed ? 'camera' : 'build');
  const [draft, setDraft] = useState<AvatarSpec>(only?.avatar_spec ?? DEFAULT_AVATAR);
  const [hint, setHint] = useState<string | null>(null);

  const start = (k: Kid) => {
    setKid(k);
    setDraft(k.avatar_spec ?? DEFAULT_AVATAR);
    setStep(k.avatar_camera_allowed ? 'camera' : 'build');
  };

  if (!kid) {
    return (
      <Frame title="Créer mon avatar" onBack={onBack}>
        <div className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          <h2 className="big">Qui crée son avatar ?</h2>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            {t.kids.map((k) => (
              <button key={k.id} className="card col" style={{ padding: 24, gap: 12, alignItems: 'center', width: 200 }} onClick={() => start(k)}>
                <KidPic kid={k} size={120} />
                <span className="h2">{k.display_name}</span>
              </button>
            ))}
          </div>
        </div>
      </Frame>
    );
  }

  const back = only ? onBack : () => setKid(null);

  if (step === 'camera') {
    return (
      <Frame title={`L'avatar de ${kid.display_name}`} onBack={back}>
        <AvatarCamera
          onDone={(suggestion) => {
            setDraft((d) => ({ ...d, ...suggestion }));
            setHint('J’ai choisi tes couleurs. Change tout ce que tu veux !');
            setStep('build');
          }}
          onSkip={() => setStep('build')}
        />
      </Frame>
    );
  }

  return (
    <Frame title={`L'avatar de ${kid.display_name}`} onBack={back}>
      <AvatarBuilder
        kid={kid}
        draft={draft}
        hint={hint}
        onChange={(d) => (setDraft(d), setHint(null))}
        onCamera={kid.avatar_camera_allowed ? () => setStep('camera') : undefined}
        onSave={async (spec) => {
          await t.saveAvatar(kid.id, spec);
          onSaved();
        }}
      />
    </Frame>
  );
}

function Frame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <>
      <div className="topbar row">
        <button className="iconbtn bg" aria-label="Retour" onClick={onBack}>
          <Icon name="left" size={32} stroke={2.6} />
        </button>
        <h1 className="h1">{title}</h1>
      </div>
      {children}
    </>
  );
}

// ------------------------------------------------------------------ camera step

type CamState = 'starting' | 'ready' | 'scanning' | 'noface' | 'denied' | 'failed';

function AvatarCamera({ onDone, onSkip }: { onDone: (s: Partial<AvatarSpec>) => void; onSkip: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CamState>('starting');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    void import('../lib/faceScan').then((m) => m.preloadFaceScan());
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
        }
        setState('ready');
      })
      .catch((err: unknown) => setState((err as Error).name === 'NotAllowedError' ? 'denied' : 'failed'));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const scan = async () => {
    if (!video.current) return;
    setState('scanning');
    try {
      const { scanFace } = await import('../lib/faceScan');
      const sample = await scanFace(video.current);
      if (!sample) return setState('noface');
      onDone(suggestFromFace(sample));
    } catch (err) {
      console.warn(err);
      setState('failed');
    }
  };

  const message: Record<CamState, string> = {
    starting: 'J’allume la caméra…',
    ready: 'Place ton visage dans l’ovale, bien en lumière.',
    scanning: 'Je regarde ton visage…',
    noface: 'Je ne vois pas bien ton visage. Rapproche-toi et réessaie !',
    denied: 'La caméra n’est pas autorisée. Tu peux créer ton avatar sans elle.',
    failed: 'La caméra ne marche pas. Tu peux créer ton avatar sans elle.',
  };
  const canScan = state === 'ready' || state === 'noface';

  return (
    <div className="row" style={{ flex: 1, gap: 48, padding: '24px 64px', justifyContent: 'center' }}>
      <div className="scanbox" style={{ width: 520, height: 520 }}>
        <video ref={video} playsInline muted style={{ transform: 'scaleX(-1)' }} />
        <svg className="corners" viewBox="0 0 520 520" aria-hidden="true">
          <ellipse cx="260" cy="250" rx="150" ry="195" fill="none" stroke="#fff" strokeWidth="6" strokeDasharray="18 14" />
        </svg>
        {state === 'scanning' && <div className="scanl" />}
      </div>
      <div className="col" style={{ gap: 24, maxWidth: 460 }}>
        <h2 className="big">Montre ton visage !</h2>
        <p className="lead" role="status">
          {message[state]}
        </p>
        <span className="hint" style={{ alignSelf: 'flex-start' }}>
          <Icon name="tablet" size={22} />
          La photo reste sur la tablette, rien n’est envoyé.
        </span>
        <div className="row" style={{ gap: 16, marginTop: 8 }}>
          {canScan && (
            <button className="bigbtn" onClick={scan}>
              <Icon name="camera" size={30} stroke={2.4} />
              C’est moi !
            </button>
          )}
          <button className="bigbtn white" onClick={onSkip} disabled={state === 'scanning'}>
            {canScan || state === 'starting' ? 'Sans caméra' : 'Continuer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ customise

function AvatarBuilder({
  kid,
  draft,
  hint,
  onChange,
  onCamera,
  onSave,
}: {
  kid: Kid;
  draft: AvatarSpec;
  hint: string | null;
  onChange: (d: AvatarSpec) => void;
  onCamera?: () => void;
  onSave: (spec: AvatarSpec | null) => Promise<void>;
}) {
  const [tab, setTab] = useState(CATEGORIES[0]!.key);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = CATEGORIES.find((c) => c.key === tab)!;

  const save = async (spec: AvatarSpec | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(spec);
    } catch {
      setError('Pas de connexion. Réessaie dans un moment.');
      setSaving(false);
    }
  };

  return (
    <div className="avwrap">
      <div className="col" style={{ gap: 20, alignItems: 'center', width: 320, flex: 'none' }}>
        <AvatarPic spec={draft} size={280} />
        {hint && <span className="hint" style={{ textAlign: 'center' }}>{hint}</span>}
        <div className="row" style={{ gap: 12 }}>
          <button className="btn soft" onClick={() => onChange({ ...randomAvatar(), skin: draft.skin, face: draft.face })}>
            <Icon name="refresh" size={24} />
            Surprise
          </button>
          {onCamera && (
            <button className="btn soft" onClick={onCamera}>
              <Icon name="camera" size={24} />
              Caméra
            </button>
          )}
        </div>
        <button className="bigbtn" onClick={() => void save(draft)} disabled={saving}>
          <Icon name="check" size={30} stroke={3} />
          {saving ? 'J’enregistre…' : 'C’est mon avatar !'}
        </button>
        {kid.avatar_spec && (
          <button className="cap" style={{ fontSize: 16, textDecoration: 'underline' }} onClick={() => void save(null)} disabled={saving}>
            Revenir à mon Gremlin
          </button>
        )}
        {error && <span className="error">{error}</span>}
      </div>

      <div className="col" style={{ gap: 16, flex: 1, minWidth: 0, minHeight: 0 }}>
        <div className="row" role="tablist" aria-label="Parties de l’avatar" style={{ gap: 10, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <button key={c.key} role="tab" className="chipk" aria-selected={c.key === tab} aria-pressed={c.key === tab} onClick={() => setTab(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="avopts" role="tabpanel" aria-label={cat.label}>
          {cat.options.map((o) => {
            const on = draft[cat.key] === o.value;
            return (
              <button key={o.value} className="avopt" aria-pressed={on} aria-label={o.label} title={o.label} onClick={() => onChange(withPart(draft, cat.key, o.value))}>
                {cat.kind === 'swatch' ? (
                  <span className="avsw" style={{ background: o.color }} />
                ) : (
                  <AvatarPic spec={withPart(draft, cat.key, o.value)} size={104} zoom={cat.zoom} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
