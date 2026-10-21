import { childPalette, stickerSvg, svgDataUri, swagStickers } from '@swag/design-tokens';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/session';
import type { Tablet } from '../lib/useTablet';
import { Icon, type IconName, Sticker } from '../ui/art';
import { WhoChips } from '../ui/WhoChips';

type Tool = 'brush' | 'erase' | 'fill' | 'stamp';
type Op =
  | { type: 'line'; color: string; size: number; points: [number, number][] }
  | { type: 'stamp'; code: string; x: number; y: number; size: number }
  | { type: 'fill'; color: string; x: number; y: number }
  | { type: 'clear' };

const W = 880;
const H = 480;
const STAMP = 110;
/** Canvas pixels per drawing unit: the canvas is drawn at double resolution so lines stay sharp. */
const RES = 2;
const BRUSH_SIZES = [8, 14, 24];
const ERASE_SIZES = [24, 48, 80];
const STAMP_MIN = 50;
const STAMP_MAX = 260;
const STAMP_STEP = 30;
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

/** A smoothed stroke: quadratic curves through the midpoints between stylus points. */
function strokeLine(ctx: CanvasRenderingContext2D, op: Extract<Op, { type: 'line' }>) {
  const pts = op.points;
  ctx.strokeStyle = op.color;
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  if (pts.length === 1) {
    ctx.lineTo(pts[0]![0] + 0.1, pts[0]![1]);
  } else if (pts.length === 2) {
    ctx.lineTo(pts[1]![0], pts[1]![1]);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i]!;
      const [nx, ny] = pts[i + 1]!;
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const last = pts.at(-1)!;
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Paint bucket: fills the area of similar colour around (x, y) (drawing units). Neighbouring pixels
 * close to the clicked colour are included, so the soft edges of strokes do not leave a white halo.
 */
function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const sx = Math.min(w - 1, Math.max(0, Math.floor(x * RES)));
  const sy = Math.min(h - 1, Math.max(0, Math.floor(y * RES)));
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const start = (sy * w + sx) * 4;
  const tr = d[start]!;
  const tg = d[start + 1]!;
  const tb = d[start + 2]!;
  const [fr, fg, fb] = hexToRgb(hex);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return; // already that colour
  const TOL = 60;
  const like = (i: number) => Math.abs(d[i]! - tr) <= TOL && Math.abs(d[i + 1]! - tg) <= TOL && Math.abs(d[i + 2]! - tb) <= TOL;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (q: number) => {
    if (!seen[q] && like(q * 4)) {
      seen[q] = 1;
      stack[top++] = q;
    }
  };
  push(sy * w + sx);
  while (top > 0) {
    const q = stack[--top]!;
    const i = q * 4;
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
    const px = q % w;
    if (px > 0) push(q - 1);
    if (px < w - 1) push(q + 1);
    if (q >= w) push(q - w);
    if (q < w * (h - 1)) push(q + w);
  }
  ctx.putImageData(img, 0, 0);
}

function drawOp(ctx: CanvasRenderingContext2D, op: Op) {
  if (op.type === 'stamp') {
    ctx.drawImage(stampImage(op.code), op.x - op.size / 2, op.y - op.size / 2, op.size, op.size);
  } else if (op.type === 'line') {
    strokeLine(ctx, op);
  } else if (op.type === 'fill') {
    floodFill(ctx, op.x, op.y, op.color);
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
  }
}

function paint(ctx: CanvasRenderingContext2D, ops: Op[]) {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  for (const op of ops) drawOp(ctx, op);
}

/** K11 "Mon dessin": draw, then one "Envoyer" sends it to the family chat. */
export function DrawScreen({ t, onBack, onSent }: { t: Tablet; onBack: () => void; onSent: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState<string>(childPalette[4]);
  const [size, setSize] = useState(14);
  const [eraseSize, setEraseSize] = useState(48);
  const [stamp, setStamp] = useState<string>(swagStickers[0]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef<Op | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  /** Index (in ops) of the stamp that can still be moved or resized, if any. */
  const [sel, setSel] = useState<number | null>(null);
  const dragging = useRef<{ dx: number; dy: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** On-screen size of the canvas box, to place the selection frame over the drawing. */
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback((list: Op[]) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) paint(ctx, list);
  }, []);
  useEffect(() => {
    redraw(ops);
  }, [ops, redraw]);
  useEffect(() => {
    // Stamps are images: repaint once they are decoded.
    swagStickers.forEach((c) => (stampImage(c).onload = () => redraw(ops)));
  }, [ops, redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] =>
    mapPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  const mapPoint = (r: DOMRect, clientX: number, clientY: number): [number, number] => {
    // The canvas is shown with objectFit "contain": the drawing is scaled down and centred,
    // leaving empty bands. Map the finger position into the drawing itself, not the whole box.
    const scale = Math.min(r.width / W, r.height / H);
    const offsetX = (r.width - W * scale) / 2;
    const offsetY = (r.height - H * scale) / 2;
    const x = (clientX - r.left - offsetX) / scale;
    const y = (clientY - r.top - offsetY) / scale;
    return [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
  };

  /** The eraser shows a ring under the stylus, the size of what it will erase. */
  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  };
  const moveCursor = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ring = cursorRef.current;
    if (!ring || !ring.parentElement) return;
    if (tool !== 'erase') return hideCursor();
    const box = ring.parentElement.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const d = eraseSize * Math.min(r.width / W, r.height / H);
    ring.style.display = 'block';
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    ring.style.transform = `translate(${e.clientX - box.left - d / 2}px, ${e.clientY - box.top - d / 2}px)`;
  };
  useEffect(() => {
    if (tool !== 'erase') hideCursor();
    if (tool !== 'stamp') setSel(null);
  }, [tool]);

  const push = (op: Op) => {
    setOps((o) => [...o, op]);
    setRedo([]);
  };
  const selected = sel !== null ? ops[sel] : undefined;
  const selStamp = selected?.type === 'stamp' ? selected : null;
  const updateSel = (patch: Partial<{ x: number; y: number; size: number }>) =>
    setOps((o) => o.map((op, i) => (i === sel && op.type === 'stamp' ? { ...op, ...patch } : op)));
  const resizeSel = (delta: number) =>
    selStamp && updateSel({ size: Math.min(STAMP_MAX, Math.max(STAMP_MIN, selStamp.size + delta)) });

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    moveCursor(e);
    const [x, y] = point(e);
    if (tool === 'stamp') {
      // Touching the selected stamp drags it; touching elsewhere places a new one.
      if (selStamp && Math.abs(x - selStamp.x) <= selStamp.size / 2 && Math.abs(y - selStamp.y) <= selStamp.size / 2) {
        dragging.current = { dx: x - selStamp.x, dy: y - selStamp.y };
        return;
      }
      setSel(ops.length);
      push({ type: 'stamp', code: stamp, x, y, size: STAMP });
      return;
    }
    if (tool === 'fill') {
      push({ type: 'fill', color, x, y });
      return;
    }
    drawing.current = { type: 'line', color: tool === 'erase' ? '#FFFFFF' : color, size: tool === 'erase' ? eraseSize : size, points: [[x, y]] };
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) drawOp(ctx, drawing.current);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e);
    if (dragging.current) {
      const [x, y] = point(e);
      updateSel({ x: x - dragging.current.dx, y: y - dragging.current.dy });
      return;
    }
    const op = drawing.current;
    if (!op || op.type !== 'line') return;
    // Take every position the stylus reported since the last event, not just the last one.
    const r = e.currentTarget.getBoundingClientRect();
    const batch = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of batch.length ? batch : [e.nativeEvent]) op.points.push(mapPoint(r, ev.clientX, ev.clientY));
    // Only the stroke being drawn is painted here; the whole drawing is repainted when it ends.
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) drawOp(ctx, op);
  };
  const up = () => {
    dragging.current = null;
    if (!drawing.current) return;
    const op = drawing.current;
    drawing.current = null;
    setOps((o) => [...o, op]);
    setRedo([]);
  };

  const undo = () => {
    setSel(null);
    setRedo((r) => [ops.at(-1)!, ...r]);
    setOps((o) => o.slice(0, -1));
  };
  const redoLast = () => {
    setSel(null);
    setOps((o) => [...o, redo[0]!]);
    setRedo((r) => r.slice(1));
  };
  const clearAll = () => {
    setSel(null);
    setConfirmClear(false);
    push({ type: 'clear' });
  };

  // Where the drawing sits inside the canvas box (objectFit "contain"), for the selection frame.
  const viewScale = Math.min(view.w / W, view.h / H) || 0;
  const viewX = (view.w - W * viewScale) / 2;
  const viewY = (view.h - H * viewScale) / 2;

  /** The PNG sent to the family keeps the drawing's own size (880 x 480), not the double-resolution canvas. */
  const exportCanvas = () => {
    const src = canvasRef.current;
    if (!src) return null;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, W, H);
    return out;
  };

  /**
   * One "Envoyer" and the drawing is on its way: the children had to confirm twice ("Envoyer",
   * then "Ça te plaît ?"), which the tester asked us to drop — a second check would only make
   * sense if there were several chats to choose from (test feedback, 21/10/2026).
   */
  const send = async () => {
    setSel(null);
    setConfirmClear(false);
    const canvas = exportCanvas();
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
        <button className="iconbtn" onClick={onBack} aria-label="Retour">
          <Icon name="left" size={32} stroke={2.6} />
        </button>
        <h1 className="h1 grow">Mon dessin</h1>
        <WhoChips kids={t.kids} who={t.who} onChange={t.setWho} />
        <button className="bigbtn" onClick={() => void send()} disabled={!ops.length || sending}>
          <Icon name="send" size={32} color="#fff" />
          Envoyer
        </button>
      </div>

      <div className="row" style={{ padding: '0 32px 18px', gap: 24, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <div className="col" style={{ gap: 14, flex: 1, minWidth: 0 }}>
          <div className="card grow" style={{ borderRadius: 36, overflow: 'hidden', background: '#fff', minHeight: 0, position: 'relative' }}>
            <canvas
              ref={canvasRef}
              width={W * RES}
              height={H * RES}
              style={{ width: '100%', height: '100%', touchAction: 'none', cursor: tool === 'stamp' && selStamp ? 'move' : 'crosshair', display: 'block', objectFit: 'contain' }}
              aria-label="Zone de dessin"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={hideCursor}
            />
            <div
              ref={cursorRef}
              aria-hidden="true"
              style={{ position: 'absolute', left: 0, top: 0, display: 'none', borderRadius: '50%', border: '2px solid var(--a-ink)', boxShadow: '0 0 0 2px #fff', pointerEvents: 'none' }}
            />
            {selStamp && viewScale > 0 && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: viewX + (selStamp.x - selStamp.size / 2) * viewScale - 6,
                  top: viewY + (selStamp.y - selStamp.size / 2) * viewScale - 6,
                  width: selStamp.size * viewScale + 12,
                  height: selStamp.size * viewScale + 12,
                  border: '3px dashed var(--a-primary)',
                  borderRadius: 16,
                  pointerEvents: 'none',
                }}
              />
            )}
            {(sending || error) && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(255,255,255,.9)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 18,
                  padding: 32,
                  textAlign: 'center',
                }}
              >
                {sending ? (
                  <>
                    <b className="h2">Ton dessin s’envoie…</b>
                    <div className="progress" style={{ width: 320 }}>
                      <div />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>
                    <button className="bigbtn" onClick={() => void send()}>
                      <Icon name="send" size={32} color="#fff" />
                      Réessayer
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="row card" style={{ padding: '10px 16px', gap: 10, borderRadius: 36, flex: 'none', overflowX: 'auto' }}>
            <span className="h3" style={{ color: 'var(--a-soft)', flex: 'none' }}>Tampons</span>
            {swagStickers.map((c) => (
              <button key={c} className="stampbtn" style={{ flex: 'none' }} aria-pressed={tool === 'stamp' && stamp === c} onClick={() => (setTool('stamp'), setStamp(c), setSel(null))} aria-label="Tampon">
                <Sticker code={c} size={52} />
              </button>
            ))}
          </div>
        </div>
        <div className="card col" style={{ width: 'clamp(250px, 28vw, 330px)', padding: 20, gap: 12, borderRadius: 36, flex: 'none', overflowY: 'auto' }}>
          <span className="cap">Outil</span>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {toolBtn('brush', 'brush', 'Pinceau')}
            {toolBtn('erase', 'eraser', 'Gomme')}
            {toolBtn('fill', 'bucket', 'Pot de peinture')}
            {toolBtn('stamp', 'stamp', 'Tampon')}
          </div>
          <span className="cap">Couleur</span>
          <div className="pal">
            {childPalette.map((c) => {
              const on = color === c && (tool === 'brush' || tool === 'fill');
              return (
                <button key={c} aria-pressed={on} style={{ background: c }} onClick={() => (setColor(c), tool !== 'fill' && setTool('brush'))} aria-label={`Couleur ${c}`}>
                  {on && <Icon name="check" size={28} color="#fff" stroke={3.4} />}
                </button>
              );
            })}
          </div>
          {tool === 'stamp' ? (
            <>
              <span className="cap">Taille du tampon</span>
              <div className="row" style={{ gap: 10 }}>
                <button className="sz" disabled={!selStamp || selStamp.size <= STAMP_MIN} onClick={() => resizeSel(-STAMP_STEP)} aria-label="Plus petit">
                  <Icon name="minus" size={30} stroke={2.6} />
                </button>
                <button className="sz" disabled={!selStamp || selStamp.size >= STAMP_MAX} onClick={() => resizeSel(STAMP_STEP)} aria-label="Plus grand">
                  <Icon name="plus" size={30} stroke={2.6} />
                </button>
              </div>
              {!selStamp && <span className="cap">Pose un tampon, puis fais-le glisser ou change sa taille.</span>}
            </>
          ) : (
          <>
          <span className="cap">{tool === 'erase' ? 'Taille de la gomme' : 'Taille du trait'}</span>
          <div className="row" style={{ gap: 10 }}>
            {tool === 'erase'
              ? ERASE_SIZES.map((z, i) => (
                  <button key={z} className="sz" aria-pressed={eraseSize === z} onClick={() => setEraseSize(z)} aria-label={`Gomme ${z}`}>
                    <i style={{ width: [12, 22, 34][i], height: [12, 22, 34][i], borderRadius: '50%', border: '2px solid var(--a-ink)', display: 'block' }} />
                  </button>
                ))
              : BRUSH_SIZES.map((z) => (
                  <button key={z} className="sz" aria-pressed={size === z} onClick={() => setSize(z)} aria-label={`Trait ${z}`}>
                    <i style={{ width: z, height: z, borderRadius: '50%', background: 'var(--a-ink)', display: 'block' }} />
                  </button>
                ))}
          </div>
          </>
          )}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn soft grow" disabled={!ops.length} onClick={undo}>
              <Icon name="undo" size={26} />
              Annuler
            </button>
            <button className="btn soft grow" disabled={!redo.length} onClick={redoLast}>
              <Icon name="redo" size={26} />
              Refaire
            </button>
          </div>
          {confirmClear ? (
            <div className="col" style={{ gap: 8 }}>
              <b className="h3">Effacer tout le dessin ?</b>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn soft grow" onClick={() => setConfirmClear(false)}>Non</button>
                <button className="btn grow" onClick={clearAll}>Oui, effacer</button>
              </div>
            </div>
          ) : (
            <button className="btn soft" disabled={!ops.length || ops.at(-1)?.type === 'clear'} onClick={() => setConfirmClear(true)}>
              <Icon name="trash" size={26} />
              Tout effacer
            </button>
          )}
        </div>
      </div>

    </>
  );
}
