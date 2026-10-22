import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * True while the soft keyboard is on screen.
 *
 * Two things depend on it: the tab bar hides so the chat gets the room (test feedback,
 * 22/10/2026), and the bottom safe-area inset is dropped, because the keyboard already
 * covers the navigation bar and the two would otherwise stack.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(show, (e) => setHeight(e.endCoordinates.height)),
      Keyboard.addListener(hide, () => setHeight(0)),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  return height;
}

/** KeyboardAvoidingView only lifted the chat halfway under edge-to-edge, so the chat now pads
 *  itself by the measured height instead (test feedback, 22/10/2026). */
export const useKeyboardOpen = () => useKeyboardHeight() > 0;
