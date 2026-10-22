import { speakerLabel } from '@swag/client';
import { swagStickers } from '@swag/design-tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaUrl } from '../lib/media';
import { speak } from '../lib/speech';
import type { ChatItem, Kid, Tablet } from '../lib/useTablet';
import { Gremlin, GremlinStack, Icon, Initial, Sticker } from '../ui/art';
import { kidColor, parentColor as tintFor } from '../ui/colors';
import { WhoChips } from '../ui/WhoChips';

type Panel = null | 'kb';

/**
 * K6-K10: the family chat (the only conversation), with stickers and a big keyboard.
 *
 * There is no "go back" button any more: the children found it unnatural and asked for the two
 * always-visible buttons of the parent app instead, so the dock switches spaces (App.tsx).
 */
export function ChatScreen({ t, onDraw, onKeyboard }: { t: Tablet; onDraw: () => void; onKeyboard: (open: boolean) => void }) {
  const [panel, setPanelState] = useState<Panel>(null);
  const [receipt, setReceipt] = useState<ChatItem | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { markRead, setChatOpen } = t;

  // App.tsx hides the dock while the keyboard panel is up, so tell it on every change.
  const setPanel = useCallback((p: Panel) => (setPanelState(p), onKeyboard(p === 'kb')), [onKeyboard]);
  useEffect(() => () => onKeyboard(false), [onKeyboard]);

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
        {panel && (
          <button className="iconbtn bg" onClick={() => setPanel(null)} aria-label="Fermer">
            <Icon name="left" size={32} stroke={2.6} />
          </button>
        )}
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
            <MessageRow key={m.id} m={m} t={t} onReceipt={setReceipt} />
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
      ) : (
        <div className="tray">
          {swagStickers.map((code) => (
            <button key={code} className="st" onClick={() => sticker(code)} aria-label="Envoyer un autocollant">
              <Sticker code={code} size={72} />
            </button>
          ))}
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

      <ReadReceipt m={receipt} t={t} onClose={() => setReceipt(null)} />
    </>
  );
}

/** The parent's chosen colour, falling back to their order in the family. */
const parentColor = (t: Tablet, id: string) => {
  const i = Math.max(0, t.parents.findIndex((p) => p.id === id));
  return tintFor(t.parents[i] ?? { avatar_key: null }, i);
};

function MessageRow({ m, t, onReceipt }: { m: ChatItem; t: Tablet; onReceipt: (m: ChatItem) => void }) {
  const fromKids = m.sender.type === 'child';
  if (!fromKids) {
    const parent = t.parents.find((p) => p.id === m.sender.id);
    const name = parent?.display_name ?? 'Parent';
    return (
      <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
        {/* Avatar and name above the bubble, the same shape as the parent app, and the name is
            now actually shown — it was only feeding the initial (test feedback, 22/10/2026). */}
        <div className="row" style={{ gap: 8, font: '700 16px var(--font-b)', color: 'var(--a-soft)' }}>
          <Initial name={name} color={parentColor(t, m.sender.id)} size={36} />
          {name}
        </div>
        <Content m={m} mine={false} />
      </div>
    );
  }
  const speakers = (m.speaker_ids.length ? m.speaker_ids : [m.sender.id])
    .map((id) => t.kids.find((k) => k.id === id))
    .filter((k): k is Kid => !!k);
  const label = speakerLabel(speakers.map((k) => k.display_name)) || 'Un enfant';
  const readBy = m.pending ? [] : t.parents.filter((p) => readsUpTo(t.readers, 'user', p.id, m.id));
  return (
    <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', font: '700 16px var(--font-b)', color: 'var(--a-soft)' }}>
        <GremlinStack colors={speakers.map(kidColor)} size={speakers.length > 1 ? 28 : 32} />
        {label}
        {speakers.length > 1 ? ' · message commun' : ''}
      </div>
      <Content m={m} mine />
      <button
        className="row receipt"
        onClick={() => onReceipt(m)}
        disabled={m.pending}
        aria-label="Voir qui a lu ce message"
        style={{ color: m.pending ? 'var(--a-soft)' : readBy.length ? 'var(--a-friend)' : 'var(--a-home)' }}
      >
        {m.pending ? <Icon name="clock" size={20} stroke={3} /> : <Ticks read={readBy.length > 0} />}
        {m.pending ? 'Envoi…' : readBy.length ? 'Lu' : 'Envoyé'}
      </button>
    </div>
  );
}

/** A member has read a message when their marker reaches it (UUIDv7 sorts by time). */
function readsUpTo(readers: Record<string, string>, type: string, id: string, messageId: string) {
  const upTo = readers[`${type}:${id}`];
  return !!upTo && upTo >= messageId;
}

/** One tick once the message is sent, two once someone has read it. */
function Ticks({ read }: { read: boolean }) {
  return (
    <span aria-hidden style={{ display: 'inline-flex' }}>
      <Icon name="check" size={20} stroke={3} />
      {read && (
        <span style={{ display: 'inline-flex', marginLeft: -11 }}>
          <Icon name="check" size={20} stroke={3} />
        </span>
      )}
    </span>
  );
}

/** Tapping a sent message says which parent has read it and which has not. */
function ReadReceipt({ m, t, onClose }: { m: ChatItem | null; t: Tablet; onClose: () => void }) {
  if (!m) return null;
  return (
    <div className="sheet" role="dialog" aria-label="Qui a lu ce message" onClick={onClose}>
      <div className="card sheetbox" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2">Qui a lu ce message ?</h2>
        {t.parents.length === 0 && <p className="lead">Personne d’autre dans la famille pour l’instant.</p>}
        {t.parents.map((p) => {
          const read = readsUpTo(t.readers, 'user', p.id, m.id);
          return (
            <div className="row" key={p.id} style={{ gap: 16 }}>
              <Initial name={p.display_name} color={parentColor(t, p.id)} />
              <span className="h3 grow">{p.display_name}</span>
              <span className="row" style={{ gap: 8, font: '700 18px var(--font-b)', color: read ? 'var(--a-friend)' : 'var(--a-soft)' }}>
                {read && <Ticks read />}
                {read ? 'Lu' : 'Pas encore lu'}
              </span>
            </div>
          );
        })}
        <button className="bigbtn" onClick={onClose} style={{ alignSelf: 'center' }}>
          Fermer
        </button>
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
      <button className="pill" onClick={() => void speak(m.body ?? '')} style={{ width: 64, height: 64, background: 'var(--a-primary-soft)', color: 'var(--a-primary)', display: 'grid', placeItems: 'center', flex: 'none' }} aria-label="Lire à voix haute">
        <Icon name="volume" size={32} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- K8 keyboard (clavier de la tablette)

function KeyboardPanel({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Met le curseur dans le champ dès l'ouverture : Android affiche alors son clavier.
  useEffect(() => inputRef.current?.focus(), []);
  const send = () => text.trim() && onSend(text.trim());
  return (
    <form className="panel" onSubmit={(e) => (e.preventDefault(), send())}>
      <div className="row" style={{ gap: 14, width: '100%' }}>
        <input
          ref={inputRef}
          className="grow textbox"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Écris ton message…"
          enterKeyHint="send"
          autoCapitalize="sentences"
          lang="fr"
          style={{ border: 0, outline: 'none', userSelect: 'text', WebkitUserSelect: 'text' }}
        />
        <button type="submit" className="bigbtn" disabled={!text.trim()}>
          <Icon name="send" size={32} color="#fff" stroke={2.4} />
          Envoyer
        </button>
      </div>
    </form>
  );
}
