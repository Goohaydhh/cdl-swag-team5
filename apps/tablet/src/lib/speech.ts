import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * Reads a message aloud for children who do not read yet.
 *
 * The Android System WebView does not implement speech synthesis — unlike Chrome — so the
 * button stayed silent on the tablet whatever we did from the page (test, 22/10/2026). This
 * goes through the device's own engine instead, and keeps the web API only as a fallback for
 * a plain browser during development.
 *
 * `speechSynthesis.cancel()` is not called before speaking: in Chromium, cancelling and
 * speaking in the same tick swallows the new utterance.
 */
export async function speak(text: string) {
  const body = text.trim();
  if (!body) return;
  try {
    await TextToSpeech.stop().catch(() => undefined);
    await TextToSpeech.speak({ text: body, lang: 'fr-FR', rate: 0.9 });
    return;
  } catch {
    // No native engine reachable here; try the page's own synthesis below.
  }
  try {
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(body);
    u.lang = 'fr-FR';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch {
    // Nothing on this device can read it aloud.
  }
}
