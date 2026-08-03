import * as Linking from 'expo-linking';
import { Alert, Platform } from 'react-native';

/**
 * Tap-to-contact helpers. These hand off to the OS dialer / SMS app / mail
 * client — they never send anything themselves. Bulk sending is a server-side
 * concern (see the compose screen) because mobile platforms do not allow an app
 * to send SMS silently.
 */

const open = async (url: string, what: string) => {
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Cannot open', `This device has no app registered for ${what}.`);
  }
};

/** Strip spaces so the dialer receives a clean number. */
const clean = (phone: string) => phone.replace(/[^\d+]/g, '');

export const callNumber = (phone: string) => open(`tel:${clean(phone)}`, 'phone calls');

export const smsNumber = (phone: string, body?: string) => {
  // iOS separates the body with `&`, Android with `?`.
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const suffix = body ? `${sep}body=${encodeURIComponent(body)}` : '';
  return open(`sms:${clean(phone)}${suffix}`, 'text messages');
};

export const emailAddress = (email: string, subject?: string) =>
  open(
    `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`,
    'email',
  );
