import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { showAlert } from '@/components/Dialog';
import { translateNow } from '@/i18n/useT';
import { normalisePhone } from '@/lib/phone';

/**
 * Tap-to-contact helpers. These hand off to the OS dialer / SMS app / mail
 * client — they never send anything themselves. Bulk sending is a server-side
 * concern (see the compose screen) because mobile platforms do not allow an app
 * to send SMS silently.
 */

/**
 * Hand a URL to the OS.
 *
 * Deliberately does NOT gate on `canOpenURL`. Since Android 11, package
 * visibility makes `canOpenURL` return false for `tel:`, `sms:` and `mailto:`
 * unless the app declares a matching `<queries>` entry in its manifest — even
 * though `openURL` on those schemes works perfectly. Checking first therefore
 * produces a false "no app registered" on most modern Android phones and blocks
 * a call that would otherwise have connected. Attempting the open and reporting
 * a real failure is both simpler and correct on every platform.
 */
const open = async (url: string, what: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    showAlert(translateNow('error.cannotOpen'), translateNow('error.noAppFor', { what }), 'danger');
  }
};

/**
 * The same normalisation the app's own sending uses.
 *
 * A dialer is more forgiving than `SmsManager`, but there is no reason for the
 * two to disagree about what a teacher's number means.
 */
const clean = (phone: string) => normalisePhone(phone);

export const callNumber = (phone: string) => open(`tel:${clean(phone)}`, 'phone calls');

export const smsNumber = (phone: string, body?: string) => {
  // iOS separates the body with `&`, Android with `?`.
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const suffix = body ? `${sep}body=${encodeURIComponent(body)}` : '';
  return open(`sms:${clean(phone)}${suffix}`, 'text messages');
};

export const emailAddress = (email: string, subject?: string) =>
  open(`mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`, 'email');
