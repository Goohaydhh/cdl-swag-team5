import { childPalette, stickerSvg, svgDataUri, swagStickers } from '@swag/design-tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/session';
import type { Tablet } from '../lib/useTablet';
import { Gremlin, Icon, type IconName, Sticker } from '../ui/art';
import { WhoChips } from '../ui/WhoChips';

type Tool = 'brush' | 'erase' | 'stamp';
type Op =
  | { type: 'line'; color: string; size: number; points: [number, number][] }
  | { type: 'stamp'; code: string; x: number; y: number };

const W = 880;
const H = 480;
const STAMP = 110;
const stampImages = new Map<string, HTMLImageElement>();
function stampImage(code: string) {
  let img = stampImages.get(code);
  if (!img) {
    img = new Image();
    img.src = svgDataUri(stickerSvg(code));
    stampImages.set(code, img);
  }
  return img;
}

function paint(ctx: CanvasRenderingContext2D, ops: Op[]) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  for (const op of ops) {
    if (op.type === 'stamp') {
      ctx.drawImage(stampImage(op.code), op.x - STAMP / 2, op.y - STAMP / 2, STAMP, STAMP);
      continue;
    }
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (op.points.length === 1) ctx.lineTo(op.points[0]![0] + 0.1, op.points[0]![1]);
    ctx.stroke();
  }
}

/** K11 "Mon dessin" and K12 "Ça te plaît ?": draw, preview, send to the family chat. */
export function DrawScreen({ t, onBack, onSent }: { t: Tablet; onBack: () => void; onSent: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState<string>(childPalette[4]);
  const [size, setSize] = useState(14);
  const [stamp, setStamp] = useState<string>(swagStickers[0]);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef<Op | null>(null);

  const redraw = useCallback((list: Op[]) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) paint(ctx, list);
  }, []);
  useEffect(() => {
    redraw(ops);
  }, [ops, redraw, preview]);
  useEffect(() => {
    // Stamps are images: repaint once they are decoded.
    swagStickers.forEach((c) => (stampImage(c).onload = () => redraw(ops)));
  }, [ops, redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    if (tool === 'stamp') {
      setOps((o) => [...o, { type: 'stamp', code: stamp, x, y }]);
      setRedo([]);
      return;
    }
    drawing.current = { type: 'line', color: tool === 'erase' ? '#FFFFFF' : color, size: tool === 'erase' ? size * 2 : size, points: [[x, y]] };
    redraw([...ops, drawing.current]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const op = drawing.current;
    if (!op || op.type !== 'line') return;
    op.points.push(point(e));
    redraw([...ops, op]);
  };
  const up = () => {
    if (!drawing.current) return;
    const op = drawing.current;
    drawing.current = null;
    setOps((o) => [...o, op]);
    setRedo([]);
  };

  const openPreview = () => setPreview(canvasRef.current?.toDataURL('image/png') ?? null);

  const send = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSending(true);
    setError(null);
    try {
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('empty'))), 'image/png'));
      const form = new FormData();
      form.append('file', blob, 'dessin.png');
      const media = await api.uploadMedia(form);
      t.sendMessage({ kind: 'drawing', media_id: media.id });
      onSent();
    } catch {
      setError('Le dessin n’est pas parti. Vérifie le Wi-Fi et réessaie.');
    } finally {
      setSending(false);
    }
  };

  const toolBtn = (k: Tool, icon: IconName, label: string) => (
    <button className="tl" aria-pressed={tool === k} onClick={() => setTool(k)} aria-label={label}>
      <Icon name={icon} size={36} stroke={2.4} />
    </button>
  );

  return (
    <>
      <div className="row" style={{ padding: '20px 32px', gap: 16, flex: 'none' }}>
        <button className="iconbtn" onClick={() => (preview ? setPreview(null) : onBack())} aria-label="Retour">
          <Icon name="left" size={32} stroke={2.6} />
        </button>
        <h1 className="h1 grow">{preview ? 'Ça te plaît ?' : 'Mon dessin'}</h1>
        {!preview && <WhoChips kids={t.kids} who={t.who} onChange={t.setWho} />}
        {!preview && (
          <button className="bigbtn" onClick={openPreview} disabled={!ops.length}>
            <Icon name="send" size={32} color="#fff" />
            Envoyer
          </button>
        )}
      </div>

      {/* The canvas stays mounted under the preview so the drawing is kept. */}
      <div className="row" style={{ padding: '0 32px 18px', gap: 24, flex: 1, minHeight: 0, alignItems: 'stretch', display: preview ? 'none' : 'flex' }}>
        <div className="col" style={{ gap: 14, flex: 1, minWidth: 0 }}>
          <div className="card grow" style={{ borderRadius: 36, overflow: 'hidden', background: '#fff', minHeight: 0 }}>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair', display: 'block', objectFit: 'contain' }}
              aria-label="Zone de dessin"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
          </div>
          <div className="row card" style={{ padding: '10px 16px', gap: 10, borderRadius: 36, flex: 'none' }}>
            <span className="h3" style={{ color: 'var(--a-soft)' }}>Tampons</span>
            {swagStickers.map((c) => (
              <button key={c} className="stampbtn" aria-pressed={tool === 'stamp' && stamp === c} onClick={() => (setTool('stamp'), setStamp(c))} aria-label="Tampon">
                <Sticker code={c} size={52} />
              </button>
            ))}
          </div>
        </div>
        <div className="card col" style={{ width: 330, padding: 20, gap: 12, borderRadius: 36, flex: 'none' }}>
          <span className="cap">Outil</span>
          <div className="row" style={{ gap: 10 }}>
            {toolBtn('brush', 'brush', 'Pinceau')}
            {toolBtn('erase', 'eraser', 'Gomme')}
            {toolBtn('stamp', 'stamp', 'Tampon')}
          </div>
          <span className="cap">Couleur</span>
          <div className="pal">
            {childPalette.map((c) => {
              const on = color === c && tool === 'brush';
              return (
                <button key={c} aria-pressed={on} style={{ background: c }} onClick={() => (setColor(c), setTool('brush'))} aria-label={`Couleur ${c}`}>
                  {on && <Icon name="check" size={28} color="#fff" stroke={3.4} />}
                </button>
              );
            })}
          </div>
          <span className="cap">Taille du trait</span>
          <div className="row" style={{ gap: 10 }}>
            {[8, 14, 24].map((z) => (
              <button key={z} className="sz" aria-pressed={size === z} onClick={() => setSize(z)} aria-label={`Trait ${z}`}>
                <i style={{ width: z, height: z, borderRadius: '50%', background: 'var(--a-ink)', display: 'block' }} />
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn soft grow" disabled={!ops.length} onClick={() => (setRedo((r) => [ops.at(-1)!, ...r]), setOps((o) => o.slice(0, -1)))}>
              <Icon name="undo" size={26} />
              Annuler
            </button>
            <button className="btn soft grow" disabled={!redo.length} onClick={() => (setOps((o) => [...o, redo[0]!]), setRedo((r) => r.slice(1)))}>
              <Icon name="redo" size={26} />
              Refaire
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <>
          <div className="row" style={{ flex: 1, padding: '0 56px', gap: 40 }}>
            <div className="card" style={{ padding: 16, borderRadius: 40, flex: 'none' }}>
              <img src={preview} alt="Aperçu du dessin" style={{ width: 640, display: 'block', borderRadius: 26 }} />
            </div>
            <div className="col" style={{ gap: 20, flex: 1 }}>
              <h2 className="h1" style={{ maxWidth: 420 }}>Ton dessin part dans le chat de la famille</h2>
              <div className="row pill" style={{ height: 84, padding: '0 24px', background: 'var(--a-primary-soft)', boxShadow: 'inset 0 0 0 4px var(--a-primary)', gap: 14 }}>
                <Gremlin color="#6B4EFF" size={52} />
                <b className="h2">Toute la famille</b>
              </div>
              {sending && (
                <div className="card col" style={{ padding: '18px 20px', gap: 10, borderRadius: 28, boxShadow: 'inset 0 0 0 2px var(--a-line)' }}>
                  <b className="h3">Ton dessin s’envoie…</b>
                  <div className="progress"><div /></div>
                </div>
              )}
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 20, padding: '20px 32px 28px' }}>
            <button className="bigbtn white" onClick={() => setPreview(null)}>
              <Icon name="brush" size={32} stroke={2.4} />
              Continuer à dessiner
            </button>
            <button className="bigbtn" onClick={send} disabled={sending}>
              <Icon name="send" size={32} color="#fff" />
              Envoyer
            </button>
          </div>
        </>
      )}
    </>
  );
}
