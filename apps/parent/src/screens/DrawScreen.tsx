import { childPalette, stickerSvg, swagStickers } from '@swag/design-tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { G, Path, Rect, SvgXml } from 'react-native-svg';
import { api } from '../lib/session';
import type { Family } from '../lib/useFamily';
import { Icon, type IconName, Sticker } from '../ui/art';
import { Button } from '../ui/kit';
import { C, s } from '../ui/theme';

/**
 * The parent draws back (test feedback, 21/10/2026: "my kids wanted me to send them a drawing,
 * they really loved the idea of communicating through this medium").
 *
 * Same tools as the tablet. The phone has no canvas, so the drawing is a list of operations
 * rendered as SVG with react-native-svg, then rasterised to PNG with `toDataURL` and sent
 * through the existing media upload — the one difference with the tablet is the paint bucket,
 * which colours the paper instead of flood-filling a region (SVG has no pixels to flood).
 */

/** The drawing space of the tablet, so a parent's drawing sits beside the children's unchanged. */
const W = 880;
const H = 480;
const WHITE = '#FFFFFF';
const STAMP = 110;
const STAMP_MIN = 50;
const STAMP_MAX = 260;
const STAMP_STEP = 30;
const BRUSH_SIZES = [8, 14, 24];
const ERASE_SIZES = [24, 48, 80];
const DOT_SIZES = [12, 22, 34];

type Tool = 'brush' | 'erase' | 'fill' | 'stamp';
type Pt = [number, number];
type Op =
  | { type: 'line'; color: string; size: number; points: Pt[] }
  | { type: 'stamp'; code: string; x: number; y: number; size: number }
  | { type: 'fill'; color: string }
  | { type: 'clear' };
type Mark = Extract<Op, { type: 'line' } | { type: 'stamp' }>;

/** A smoothed stroke: quadratic curves through the midpoints between finger positions. */
function pathD(pts: Pt[]): string {
  const first = pts[0];
  if (!first) return '';
  if (pts.length === 1) return `M${first[0]} ${first[1]} l0.1 0`;
  if (pts.length === 2) return `M${first[0]} ${first[1]} L${pts[1]![0]} ${pts[1]![1]}`;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = pts.at(-1)!;
  return `${d} L${last[0]} ${last[1]}`;
}

/** Paper colour and the marks still on it: "tout effacer" hides everything drawn before it. */
function compose(ops: Op[]) {
  let bg = WHITE;
  let from = 0;
  ops.forEach((op, i) => {
    if (op.type === 'clear') {
      bg = WHITE;
      from = i + 1;
    } else if (op.type === 'fill') {
      bg = op.color;
    }
  });
  const marks = ops.slice(from).filter((op): op is Mark => op.type === 'line' || op.type === 'stamp');
  return { bg, marks };
}

export function DrawScreen({
  visible,
  f,
  onClose,
  onSent,
}: {
  visible: boolean;
  f: Family;
  onClose: () => void;
  onSent: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState<string>(childPalette[4]);
  const [size, setSize] = useState(14);
  const [eraseSize, setEraseSize] = useState(48);
  const [stamp, setStamp] = useState<string>(swagStickers[0]);
  const [sel, setSel] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [live, setLive] = useState<Pt[] | null>(null);

  const svgRef = useRef<Svg>(null);
  const liveRef = useRef<Pt[] | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const { bg, marks } = useMemo(() => compose(ops), [ops]);
  const boxH = boxW ? (boxW * H) / W : 0;
  const selected = sel !== null ? ops[sel] : undefined;
  const selStamp = selected?.type === 'stamp' ? selected : null;

  // The gesture handlers are built once, so everything they read lives in this ref.
  const cfg = useRef({ tool, color, size, eraseSize, stamp, sel, ops, boxW, boxH, bg });
  cfg.current = { tool, color, size, eraseSize, stamp, sel, ops, boxW, boxH, bg };

  // A fresh sheet of paper every time the screen opens.
  useEffect(() => {
    if (!visible) return;
    liveRef.current = null;
    drag.current = null;
    setOps([]);
    setRedo([]);
    setLive(null);
    setSel(null);
    setTool('brush');
    setConfirmClear(false);
    setError(null);
  }, [visible]);

  const setLiveBoth = (pts: Pt[] | null) => {
    liveRef.current = pts;
    setLive(pts);
  };
  const push = (op: Op) => {
    setOps((o) => [...o, op]);
    setRedo([]);
  };
  const updateSel = (patch: Partial<{ x: number; y: number; size: number }>) =>
    setOps((o) => o.map((op, i) => (i === cfg.current.sel && op.type === 'stamp' ? { ...op, ...patch } : op)));
  const resizeSel = (delta: number) =>
    selStamp && updateSel({ size: Math.min(STAMP_MAX, Math.max(STAMP_MIN, selStamp.size + delta)) });

  /** Finger position inside the box -> drawing units. */
  const toDrawing = (lx: number, ly: number): Pt => {
    const { boxW: bw, boxH: bh } = cfg.current;
    if (!bw || !bh) return [0, 0];
    const x = (lx / bw) * W;
    const y = (ly / bh) * H;
    return [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
  };

  const endStroke = () => {
    drag.current = null;
    const pts = liveRef.current;
    setLiveBoth(null);
    if (!pts?.length) return;
    const c = cfg.current;
    push({
      type: 'line',
      // The eraser paints the paper colour, so it also works on a filled background.
      color: c.tool === 'erase' ? c.bg : c.color,
      size: c.tool === 'erase' ? c.eraseSize : c.size,
      points: pts,
    });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const c = cfg.current;
          const p = toDrawing(e.nativeEvent.locationX, e.nativeEvent.locationY);
          if (c.tool === 'stamp') {
            const current = c.sel !== null ? c.ops[c.sel] : undefined;
            // Touching the selected stamp drags it; touching elsewhere places a new one.
            if (
              current?.type === 'stamp' &&
              Math.abs(p[0] - current.x) <= current.size / 2 &&
              Math.abs(p[1] - current.y) <= current.size / 2
            ) {
              drag.current = { dx: p[0] - current.x, dy: p[1] - current.y };
              return;
            }
            setSel(c.ops.length);
            push({ type: 'stamp', code: c.stamp, x: p[0], y: p[1], size: STAMP });
            return;
          }
          if (c.tool === 'fill') {
            push({ type: 'fill', color: c.color });
            return;
          }
          setLiveBoth([p]);
        },
        onPanResponderMove: (e) => {
          const p = toDrawing(e.nativeEvent.locationX, e.nativeEvent.locationY);
          if (drag.current) {
            updateSel({ x: p[0] - drag.current.dx, y: p[1] - drag.current.dy });
            return;
          }
          if (liveRef.current) setLiveBoth([...liveRef.current, p]);
        },
        onPanResponderRelease: endStroke,
        onPanResponderTerminate: endStroke,
      }),
    // Built once on purpose: the handlers read the live values from `cfg`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** PNG of the drawing at the tablet's size, as base64 (no `data:` prefix). */
  const exportPng = () =>
    new Promise<string>((resolve, reject) => {
      const node = svgRef.current;
      if (!node?.toDataURL) {
        reject(new Error('export unavailable'));
        return;
      }
      node.toDataURL((data) => (data ? resolve(data) : reject(new Error('empty export'))), { width: W, height: H });
    });

  const send = async () => {
    setSel(null);
    setConfirmClear(false);
    setSending(true);
    setError(null);
    try {
      const base64 = await exportPng();
      const form = new FormData();
      // React Native uploads a file by URI: a data: URI avoids writing a temp file first.
      form.append('file', {
        uri: `data:image/png;base64,${base64}`,
        name: 'dessin.png',
        type: 'image/png',
      } as unknown as Blob);
      const media = await api.uploadMedia(form);
      await f.send({ kind: 'drawing', media_id: media.id });
      onSent();
    } catch {
      setError('Le dessin n’est pas parti. Vérifie ta connexion et réessaie.');
    } finally {
      setSending(false);
    }
  };

  const toolBtn = (key: Tool, icon: IconName, label: string) => {
    const on = tool === key;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => setTool(key)}
        style={{
          flex: 1,
          height: 52,
          borderRadius: 16,
          backgroundColor: on ? C.primary : C.surface,
          borderWidth: on ? 0 : 2,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={24} color={on ? '#fff' : C.ink} stroke={2.4} />
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            onPress={onClose}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x" size={22} stroke={2.6} />
          </Pressable>
          <Text style={[s.h3, s.grow]}>Mon dessin</Text>
          <Button label="Envoyer" icon="send" height={46} busy={sending} disabled={!marks.length || sending} onPress={() => void send()} />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <View
            onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
            style={[s.card, { overflow: 'hidden', aspectRatio: W / H }]}
            {...pan.panHandlers}
          >
            {boxW > 0 && (
              <Svg ref={svgRef} width={boxW} height={boxH} viewBox={`0 0 ${W} ${H}`}>
                <Rect x={0} y={0} width={W} height={H} fill={bg} />
                {marks.map((op, i) =>
                  op.type === 'line' ? (
                    <Path
                      key={i}
                      d={pathD(op.points)}
                      stroke={op.color}
                      strokeWidth={op.size}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <G key={i} transform={`translate(${op.x - op.size / 2} ${op.y - op.size / 2}) scale(${op.size / 64})`}>
                      <SvgXml xml={stickerSvg(op.code)} width={64} height={64} />
                    </G>
                  ),
                )}
                {live && live.length > 0 && (
                  <Path
                    d={pathD(live)}
                    stroke={tool === 'erase' ? bg : color}
                    strokeWidth={tool === 'erase' ? eraseSize : size}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </Svg>
            )}
            {selStamp && boxW > 0 && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: ((selStamp.x - selStamp.size / 2) * boxW) / W - 4,
                  top: ((selStamp.y - selStamp.size / 2) * boxH) / H - 4,
                  width: (selStamp.size * boxW) / W + 8,
                  height: (selStamp.size * boxH) / H + 8,
                  borderWidth: 2,
                  borderColor: C.primary,
                  borderStyle: 'dashed',
                  borderRadius: 12,
                }}
              />
            )}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {error && <Text style={s.error}>{error}</Text>}

          <Text style={s.cap}>Outil</Text>
          <View style={[s.row, { gap: 10 }]}>
            {toolBtn('brush', 'brush', 'Pinceau')}
            {toolBtn('erase', 'eraser', 'Gomme')}
            {toolBtn('fill', 'bucket', 'Pot de peinture')}
            {toolBtn('stamp', 'stamp', 'Tampon')}
          </View>

          <Text style={s.cap}>Couleur</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {childPalette.map((c) => {
              const on = color === c && (tool === 'brush' || tool === 'fill');
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  accessibilityLabel={`Couleur ${c}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => (setColor(c), tool !== 'fill' && setTool('brush'))}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: c,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: on ? 3 : 0,
                    borderColor: C.ink,
                  }}
                >
                  {on && <Icon name="check" size={20} color="#fff" stroke={3.2} />}
                </Pressable>
              );
            })}
          </View>

          {tool === 'stamp' ? (
            <>
              <Text style={s.cap}>Tampons</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {swagStickers.map((c) => {
                  const on = stamp === c;
                  return (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityLabel="Tampon"
                      accessibilityState={{ selected: on }}
                      onPress={() => (setStamp(c), setSel(null))}
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 16,
                        backgroundColor: on ? C.primarySoft : C.surface,
                        borderWidth: on ? 2 : 0,
                        borderColor: C.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Sticker code={c} size={36} />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.cap}>Taille du tampon</Text>
              <View style={[s.row, { gap: 10 }]}>
                <Button label="Plus petit" icon="minus" variant="soft" height={46} style={{ flex: 1 }} disabled={!selStamp || selStamp.size <= STAMP_MIN} onPress={() => resizeSel(-STAMP_STEP)} />
                <Button label="Plus grand" icon="plus" variant="soft" height={46} style={{ flex: 1 }} disabled={!selStamp || selStamp.size >= STAMP_MAX} onPress={() => resizeSel(STAMP_STEP)} />
              </View>
              {!selStamp && <Text style={s.cap}>Pose un tampon, puis fais-le glisser ou change sa taille.</Text>}
            </>
          ) : (
            <>
              <Text style={s.cap}>{tool === 'erase' ? 'Taille de la gomme' : 'Taille du trait'}</Text>
              <View style={[s.row, { gap: 10 }]}>
                {(tool === 'erase' ? ERASE_SIZES : BRUSH_SIZES).map((z, i) => {
                  const on = tool === 'erase' ? eraseSize === z : size === z;
                  const dot = DOT_SIZES[i]!;
                  return (
                    <Pressable
                      key={z}
                      accessibilityRole="button"
                      accessibilityLabel={tool === 'erase' ? `Gomme ${z}` : `Trait ${z}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => (tool === 'erase' ? setEraseSize(z) : setSize(z))}
                      style={{
                        width: 60,
                        height: 48,
                        borderRadius: 16,
                        backgroundColor: on ? C.primarySoft : C.surface,
                        borderWidth: on ? 2 : 0,
                        borderColor: C.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: dot,
                          height: dot,
                          borderRadius: dot / 2,
                          backgroundColor: tool === 'erase' ? 'transparent' : C.ink,
                          borderWidth: tool === 'erase' ? 2 : 0,
                          borderColor: C.ink,
                        }}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <View style={[s.row, { gap: 10 }]}>
            <Button label="Annuler" icon="undo" variant="soft" height={46} style={{ flex: 1 }} disabled={!ops.length} onPress={() => (setSel(null), setRedo((r) => [ops.at(-1)!, ...r]), setOps((o) => o.slice(0, -1)))} />
            <Button label="Refaire" icon="redo" variant="soft" height={46} style={{ flex: 1 }} disabled={!redo.length} onPress={() => (setSel(null), setOps((o) => [...o, redo[0]!]), setRedo((r) => r.slice(1)))} />
          </View>

          {confirmClear ? (
            <View style={{ gap: 8 }}>
              <Text style={s.strong}>Effacer tout le dessin ?</Text>
              <View style={[s.row, { gap: 10 }]}>
                <Button label="Non" variant="soft" height={46} style={{ flex: 1 }} onPress={() => setConfirmClear(false)} />
                <Button label="Oui, effacer" height={46} style={{ flex: 1 }} onPress={() => (setSel(null), setConfirmClear(false), push({ type: 'clear' }))} />
              </View>
            </View>
          ) : (
            <Button label="Tout effacer" icon="trash" variant="white" height={46} disabled={!marks.length} onPress={() => setConfirmClear(true)} />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
