/**
 * Room to scroll while the keyboard is up.
 *
 * `softwareKeyboardLayoutMode: "resize"` and `automaticallyAdjustKeyboardInsets`
 * both make the *space* correct — the window shrinks on Android, the scroll
 * view is padded on iOS. Neither helps when the content already fits: there is
 * nothing to scroll, so a field near the bottom simply stays behind the
 * keyboard however hard the teacher swipes.
 *
 * Padding the content by the keyboard's real height creates that room, and only
 * then does scrolling to the end put the editor above it. The height comes from
 * the event rather than a constant because it varies with the keyboard, the
 * suggestion strip, and the language.
 *
 * `onShow` fires after the padding has been applied, which is when a caller can
 * usefully scroll.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardInset(onShow?: () => void) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // `will*` on iOS so the padding animates with the keyboard rather than
    // snapping in after it; Android only has the `did*` pair.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      setInset(e.endCoordinates.height);
      // Next frame, not this one: the padding has to land before there is
      // anywhere to scroll to.
      requestAnimationFrame(() => onShow?.());
    });
    const hide = Keyboard.addListener(hideEvent, () => setInset(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, [onShow]);

  return inset;
}
