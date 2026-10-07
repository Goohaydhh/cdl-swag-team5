import { type GifSearchResult, speakerLabel, SwagApiError } from '@swag/client';
import { swagStickers } from '@swag/design-tokens';
import { useEffect, useRef, useState } from 'react';
import { useMediaUrl } from '../lib/media';
import { api } from '../lib/session';
import type { ChatItem, Kid, Tablet } from '../lib/useTablet';
import { Gremlin, GremlinStack, Icon, Initial, Sticker } from '../ui/art';
import { kidColor, PARENT_COLORS } from '../ui/colors';
import { WhoChips } from '../ui/WhoChips';

type Panel = null | 'gif' | 'kb';

/** K6-K10: the family chat (the only conversation), with stickers, GIFs and a big keyboard. */
export function ChatScreen({ t, onBack, onDraw }: { t: Tablet; onBack: () => void; onDraw: () => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { markRead, setChatOpen } = t;

  useEffect(() => {
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [setChatOpen]);
  useEffect(() => {
    markRead();
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [t.messages.length, markRead]);

  const sticker = (code: string) => t.sendMessage({ kind: 'sticker', sticker_code: code });

  return (
    <>
      <div className="row topbar">
        <button className="iconbtn bg" onClick={() => (panel ? setPanel(null) : onBack())} aria-label="Retour">
          <Icon name="left" size={32} stroke={2.6} />
        </button>
        <h1 className="h1 grow">Toute la famille</h1>
        <WhoChips kids={t.kids} who={t.who} onChange={t.setWho} />
      </div>

      {t.messages.length === 0 ? (
        <div className="col" style={{ flex: 1, minHeight: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center' }}>
          {!panel && <Gremlin color="#6B4EFF" size={140} />}
          <h2 className="big">Dis bonjour à ta famille !</h2>
          <p className="lead" style={{ fontSize: 22 }}>Touche un autocollant, fais un dessin ou écris un message.</p>
          <div className="row" style={{ gap: 20 }}>
            {['swag/heart', 'swag/star', 'swag/sun'].map((code) => (
              <button key={code} className="card" onClick={() => sticker(code)} style={{ width: 130, height: 130, display: 'grid', placeItems: 'center', borderRadius: 36 }} aria-label="Envoyer un autocollant">
                <Sticker code={code} size={92} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="msgs" ref={listRef} aria-live="polite">
          {t.messages.map((m) => (
            <MessageRow key={m.id} m={m} t={t} />
          ))}
          {t.typingParent && (
            <div className="row" style={{ gap: 12 }}>
              <Initial name={t.typingParent.display_name} color={parentColor(t, t.typingParent.id)} />
              <span className="card row dots" style={{ padding: '16px 22px', gap: 8, borderRadius: 32 }}>
                <i style={{ width: 14, height: 14 }} />
                <i style={{ width: 14, height: 14 }} />
                <i style={{ width: 14, height: 14 }} />
              </span>
              <span className="cap" style={{ fontSize: 16 }}>{t.typingParent.display_name} écrit</span>
            </div>
          )}
        </div>
      )}

      {(t.outboxSize > 0 || !t.online) && (
        <div style={{ padding: '0 48px 10px', flex: 'none' }}>
          <span className="hint" style={{ fontSize: 18 }}>
            <Icon name={t.online ? 'clock' : 'wifiOff'} size={24} />
            {t.online ? 'Envoi en cours…' : 'Pas encore envoyé. Garde la tablette sur le Wi-Fi.'}
          </span>
        </div>
      )}

      {panel === 'kb' ? (
        <KeyboardPanel onSend={(text) => (t.sendMessage({ kind: 'text', body: text }), setPanel(null))} />
      ) : panel === 'gif' ? (
        <GifPanel onStickers={() => setPanel(null)} onPick={(ref) => (t.sendMessage({ kind: 'gif', gif_ref: ref }), setPanel(null))} />
      ) : (
        <div className="tray">
          {swagStickers.map((code) => (
            <button key={code} className="st" onClick={() => sticker(code)} aria-label="Envoyer un autocollant">
              <Sticker code={code} size={72} />
            </button>
          ))}
          <button className="st" onClick={() => setPanel('gif')} aria-label="Choisir un GIF" style={{ font: '700 24px var(--font-d)', color: 'var(--a-primary)' }}>
            GIF
          </button>
          <button className="st" onClick={() => setPanel('kb')} aria-label="Écrire un message" style={{ color: 'var(--a-primary)' }}>
            <Icon name="keyboard" size={44} />
          </button>
          <span style={{ width: 2, height: 64, background: 'var(--a-line)' }} />
          <button className="bigbtn" onClick={onDraw}>
            <Icon name="brush" size={32} color="#fff" stroke={2.4} />
            Dessiner
          </button>
        </div>
      )}
    </>
  );
}

const parentColor = (t: Tablet, id: string) => PARENT_COLORS[Math.max(0, t.parents.findIndex((p) => p.id === id)) % PARENT_COLORS.length]!;

function MessageRow({ m, t }: { m: ChatItem; t: Tablet }) {
  const fromKids = m.sender.type === 'child';
  if (!fromKids) {
    const parent = t.parents.find((p) => p.id === m.sender.id);
    const name = parent?.display_name ?? 'Parent';
    return (
      <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Initial name={name} color={parentColor(t, m.sender.id)} />
          <Content m={m} mine={false} />
        </div>
      </div>
    );
  }
  const speakers = (m.speaker_ids.length ? m.speaker_ids : [m.sender.id])
    .map((id) => t.kids.find((k) => k.id === id))
    .filter((k): k is Kid => !!k);
  const label = speakerLabel(speakers.map((k) => k.display_name)) || 'Un enfant';
  const read = !m.pending && t.readUpTo && t.readUpTo.id >= m.id ? t.parents.find((p) => p.id === t.readUpTo!.by) : null;
  return (
    <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', font: '700 16px var(--font-b)', color: 'var(--a-soft)' }}>
        <GremlinStack colors={speakers.map(kidColor)} size={speakers.length > 1 ? 28 : 32} />
        {label}
        {speakers.length > 1 ? ' · message commun' : ''}
      </div>
      <Content m={m} mine />
      <div className="row" style={{ gap: 6, font: '700 16px var(--font-b)', color: m.pending ? 'var(--a-soft)' : read ? 'var(--a-friend)' : 'var(--a-home)' }}>
        <Icon name={m.pending ? 'clock' : 'check'} size={20} stroke={3} />
        {m.pending ? 'Envoi…' : read ? `Lu par ${read.display_name}` : 'Envoyé'}
      </div>
    </div>
  );
}

function Content({ m, mine }: { m: ChatItem; mine: boolean }) {
  const url = useMediaUrl(m.kind === 'drawing' || m.kind === 'gif' ? m.media_id : undefined);
  if (m.kind === 'sticker') return <Sticker code={m.sticker_code ?? 'swag/star'} size={110} />;
  if (m.kind === 'gif' || m.kind === 'drawing') {
    return (
      <div style={{ background: mine ? 'var(--a-primary)' : 'var(--a-card)', padding: 10, borderRadius: 32, boxShadow: '0 4px 16px rgba(42,27,77,.09)' }}>
        {url ? (
          <img className="media-img" src={url} alt={m.kind === 'gif' ? 'GIF' : 'Dessin'} />
        ) : (
          <div className="media-img" style={{ width: 300, height: 180, display: 'grid', placeItems: 'center', color: 'var(--a-soft)' }}>
            {m.pending ? 'Envoi…' : 'Chargement…'}
          </div>
        )}
      </div>
    );
  }
  if (mine) {
    return (
      <div className="row bubble-me">
        <span className="msgtext">{m.body}</span>
      </div>
    );
  }
  return (
    <div className="card row bubble-them">
      <span className="msgtext">{m.body}</span>
      <button className="pill" onClick={() => speak(m.body ?? '')} style={{ width: 64, height: 64, background: 'var(--a-primary-soft)', color: 'var(--a-primary)', display: 'grid', placeItems: 'center', flex: 'none' }} aria-label="Lire à voix haute">
        <Icon name="volume" size={32} />
      </button>
    </div>
  );
}

/** Reads a parent's message aloud for children who do not read yet. */
function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    // No speech engine on this tablet.
  }
}

// ---------------------------------------------------------------- K8 keyboard

const ROWS = ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN'];
const ACCENTS = ['É', 'È', 'À', 'Ç'];

function KeyboardPanel({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const add = (c: string) => setText((s) => (s.length < 300 ? s + c : s));
  const key = (c: string, w = 88) => (
    <button key={c} className="keyk" onClick={() => add(c)} aria-label={c} style={{ width: w, height: 60, borderRadius: 16 }}>
      {c}
    </button>
  );
  return (
    <div className="panel" style={{ alignItems: 'center', gap: 10 }}>
      <div className="row" style={{ gap: 14, width: '100%' }}>
        <div className="grow textbox" aria-live="polite">
          {text ? (
            <>
              {text}
              <i className="caret" />
            </>
          ) : (
            <span style={{ color: 'var(--a-soft)' }}>Écris ton message…</span>
          )}
        </div>
        <button className="bigbtn" disabled={!text.trim()} onClick={() => onSend(text.trim())}>
          <Icon name="send" size={32} color="#fff" stroke={2.4} />
          Envoyer
        </button>
      </div>
      {ROWS.map((r, i) => (
        <div className="row" style={{ gap: 8, justifyContent: 'center' }} key={r}>
          {r.split('').map((c) => key(c))}
          {i === 2 && ACCENTS.map((c) => key(c))}
        </div>
      ))}
      <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
        <button className="keyk" onClick={() => setText((s) => s.slice(0, -1))} aria-label="Effacer" style={{ width: 150, height: 60, borderRadius: 16 }}>
          <Icon name="del" size={30} stroke={2.4} />
        </button>
        <button className="keyk" onClick={() => add(' ')} aria-label="Espace" style={{ width: 420, height: 60, borderRadius: 16, fontSize: 20 }}>
          espace
        </button>
        {['?', '!', '.', ','].map((c) => key(c, 76))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- K7 GIFs

const GIF_TOPICS = ['Bravo', 'Rigolo', 'Câlin', 'Fête', 'Animaux'];

function GifPanel({ onPick, onStickers }: { onPick: (gifRef: string) => void; onStickers: () => void }) {
  const [topic, setTopic] = useState(GIF_TOPICS[0]!);
  const [state, setState] = useState<{ topic: string; result?: GifSearchResult; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .searchGifs(topic)
      .then((result) => alive && setState({ topic, result }))
      .catch((err: unknown) => {
        if (!alive) return;
        const error =
          err instanceof SwagApiError && err.status === 503
            ? 'Les GIF ne sont pas disponibles pour le moment.'
            : 'Pas de connexion pour chercher des GIF.';
        setState({ topic, error });
      });
    return () => {
      alive = false;
    };
  }, [topic]);
  const current = state?.topic === topic ? state : null;
  const result = current?.result ?? null;
  const error = current?.error ?? null;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 10 }}>
        <button className="chipk" onClick={onStickers}>Autocollants</button>
        <span className="chipk" style={{ background: 'var(--a-primary)', color: '#fff' }}>GIF</span>
        <span className="grow" />
        {GIF_TOPICS.map((c) => (
          <button key={c} className="chipk" aria-pressed={c === topic} onClick={() => setTopic(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="gifgrid">
        {error && <p className="lead">{error}</p>}
        {!error && !result && <p className="lead">Je cherche des GIF…</p>}
        {result?.items.slice(0, 12).map((g) => (
          <button key={g.gif_ref} onClick={() => onPick(g.gif_ref)} aria-label={`Envoyer le GIF ${g.title}`}>
            <img src={api.absolute(g.preview_path)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {result && <div className="cap">{result.attribution} · GIF adaptés aux enfants</div>}
    </div>
  );
}
