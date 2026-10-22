// Notification sound for the tablet (test feedback, 21 October 2026): children are not glued
// to the tablet, so they need to HEAR that a message arrived from the next room.
//
// The chime is synthesised with the Web Audio API rather than shipped as an audio file: no asset
// to bundle in the Capacitor build, no decoding delay, and the volume is ours to set.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Browsers (and the Android webview) only allow sound after the first user gesture, so the
 * audio context is created and resumed on the tablet's first touch. Called once from App.
 */
export function unlockSound() {
  const c = context();
  if (c?.state === 'suspended') void c.resume();
}

/** One bell-like note: soft attack, exponential decay, so it never sounds like an alarm. */
function note(c: AudioContext, freq: number, startAt: number, duration: number, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

/**
 * Two rising notes (A5 then E6) played when a parent's message arrives, whether or not the
 * chat is open: the point is to be heard across the room.
 */
export function playMessageSound() {
  const c = context();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  try {
    const t = c.currentTime + 0.01;
    note(c, 880, t, 0.35, 0.28);
    note(c, 1318.5, t + 0.13, 0.45, 0.22);
  } catch {
    // No audio output on this tablet: the unread badge still shows the message.
  }
}
