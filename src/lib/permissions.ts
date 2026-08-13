/**
 * Every permission ClassCare uses, in one place.
 *
 * The app asks for these together on first entry, on a screen that says what
 * each one is for before any system dialog appears. That ordering is the whole
 * point: Android allows two refusals before it stops showing the dialog at all,
 * so the one chance to ask has to come with the reason attached. A cold prompt
 * for "send SMS" from a class-management app reads as malware and gets denied
 * permanently, and no amount of asking later can undo that.
 *
 * Nothing here is required. Every one of them is refused gracefully somewhere:
 * no SMS permission means the composer offers email only, no camera means a
 * student keeps their initials, no contacts means typing the number in. The
 * screen says so, because a list of demands with no way past it is the other
 * way apps get uninstalled.
 */
import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';

import type { TranslationKey } from '@/i18n';
import { hasSmsPermission, deviceSmsSupported, requestSmsPermission } from '@/lib/deviceSms';
import { notificationPermissionStatus, requestNotificationPermission } from '@/lib/notifications';

export type PermissionKey = 'notifications' | 'sms' | 'contacts' | 'photos' | 'camera';

export type PermissionInfo = {
  key: PermissionKey;
  icon: 'bell' | 'chat' | 'contacts' | 'image' | 'search';
  titleKey: TranslationKey;
  reasonKey: TranslationKey;
};

/**
 * Ordered by how much the app depends on it.
 *
 * Notifications first because a reply from a parent is the one thing only the
 * server knows about; the camera last because a student without a picture is
 * merely a student without a picture.
 */
export const PERMISSIONS: PermissionInfo[] = [
  {
    key: 'notifications',
    icon: 'bell',
    titleKey: 'perm.notifications',
    reasonKey: 'perm.notificationsWhy',
  },
  { key: 'sms', icon: 'chat', titleKey: 'perm.sms', reasonKey: 'perm.smsWhy' },
  { key: 'contacts', icon: 'contacts', titleKey: 'perm.contacts', reasonKey: 'perm.contactsWhy' },
  { key: 'photos', icon: 'image', titleKey: 'perm.photos', reasonKey: 'perm.photosWhy' },
  { key: 'camera', icon: 'search', titleKey: 'perm.camera', reasonKey: 'perm.cameraWhy' },
];

/** Which of them apply on this device. SMS is Android-with-a-radio only. */
export const applicablePermissions = (): PermissionInfo[] =>
  PERMISSIONS.filter((p) => p.key !== 'sms' || deviceSmsSupported());

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * What the OS currently thinks, without asking for anything.
 *
 * Every one of these is a read: `getPermissionsAsync` never shows a dialog. It
 * matters because the screen is reachable again from Profile, where showing
 * "Allow" next to something already allowed would be a button that does
 * nothing.
 */
export async function readPermissionStates(): Promise<Record<PermissionKey, PermissionState>> {
  const [notifications, contacts, photos, camera] = await Promise.all([
    notificationPermissionStatus().catch(() => 'undetermined' as PermissionState),
    Contacts.getPermissionsAsync()
      .then(toState)
      .catch(() => 'undetermined' as PermissionState),
    ImagePicker.getMediaLibraryPermissionsAsync()
      .then(toState)
      .catch(() => 'undetermined' as PermissionState),
    ImagePicker.getCameraPermissionsAsync()
      .then(toState)
      .catch(() => 'undetermined' as PermissionState),
  ]);

  return {
    notifications: notifications as PermissionState,
    // The native module answers this one synchronously and has no
    // "undetermined" to report, so a refusal and a never-asked look the same.
    // Treating false as undetermined is right for the screen: it means the
    // button stays offered, and asking again when Android has stopped showing
    // the dialog simply returns denied.
    sms: hasSmsPermission() ? 'granted' : 'undetermined',
    contacts,
    photos,
    camera,
  };
}

function toState(result: { granted: boolean; canAskAgain?: boolean }): PermissionState {
  if (result.granted) return 'granted';
  return result.canAskAgain === false ? 'denied' : 'undetermined';
}

/**
 * Ask for one, and report what came back.
 *
 * Sequential by necessity — Android shows one dialog at a time and queueing
 * them produces a stack the teacher taps through blind — so the caller asks in
 * order and shows progress as it goes.
 */
export async function requestPermission(key: PermissionKey): Promise<PermissionState> {
  try {
    switch (key) {
      case 'notifications':
        return (await requestNotificationPermission()) ? 'granted' : 'denied';
      case 'sms':
        return (await requestSmsPermission()).granted ? 'granted' : 'denied';
      case 'contacts':
        return toState(await Contacts.requestPermissionsAsync());
      case 'photos':
        return toState(await ImagePicker.requestMediaLibraryPermissionsAsync());
      case 'camera':
        return toState(await ImagePicker.requestCameraPermissionsAsync());
    }
  } catch {
    // A permission that cannot even be asked for — a device without the
    // hardware, a manufacturer ROM being unusual — is not an error worth
    // stopping the run for.
    return 'denied';
  }
}
