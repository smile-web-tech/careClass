/**
 * A picture on a student.
 *
 * Faces make a register readable at a glance — a teacher with four groups of
 * twenty knows the faces long before they know which Aýgül is which on paper.
 *
 * Everything here is built around one constraint: a phone camera in 2026
 * produces a 4 MB JPEG, and these teachers are on mobile data priced by the
 * megabyte. So nothing is ever stored or uploaded at capture size. The picture
 * is resized to 512px on its long edge and re-encoded at 80% quality before it
 * touches the disk, which lands between 30 and 60 KB — small enough to sync a
 * whole school over a bad connection, and still sharp on a 3x screen at the
 * size it is actually displayed.
 *
 * Files live in `ClassCare/photos`, one per student, named by id. Not in the
 * media library: a teacher's photo roll should not fill up with other people's
 * children, and a picture that is only meaningful inside ClassCare belongs
 * inside ClassCare.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { moveIfPresent, photosDirectory } from '@/lib/appFolder';
import { translateNow } from '@/i18n/useT';
import { supabase } from '@/lib/supabase';

/*
  The camera and the image tools are loaded when they are used, not when this
  file is imported.

  An Expo module resolves its native counterpart at import time and throws
  "Cannot find native module" if the running binary does not contain it. This
  file is reached from `components/ui.tsx`, which every screen imports, so a
  top-level import here meant an app installed from a build older than these
  packages could not render a single screen — every route failed with a missing
  default export, which is the symptom rather than the cause and sends anyone
  looking in the wrong place entirely.

  Loading on use keeps that failure where it belongs: on the button that needs
  the camera, with a sentence saying the app needs updating.
*/
type ImagePickerModule = typeof import('expo-image-picker');
type ManipulatorModule = typeof import('expo-image-manipulator');

/** Thrown when the running build predates the module a feature needs. */
export class MissingNativeModule extends Error {
  constructor() {
    super(translateNow('error.needsNewBuild'));
    this.name = 'MissingNativeModule';
  }
}

function imagePicker(): ImagePickerModule {
  try {
    return require('expo-image-picker') as ImagePickerModule;
  } catch {
    throw new MissingNativeModule();
  }
}

function manipulator(): ManipulatorModule {
  try {
    return require('expo-image-manipulator') as ManipulatorModule;
  } catch {
    throw new MissingNativeModule();
  }
}

/** Whether this build can take and shrink a picture at all. */
export function photoToolsAvailable(): boolean {
  try {
    require('expo-image-picker');
    require('expo-image-manipulator');
    return true;
  } catch {
    return false;
  }
}

/** The long edge, in pixels. Displayed at 52pt, so this is generous already. */
const MAX_EDGE = 512;

/** JPEG quality. Below about 0.7 the artefacts show on skin. */
const QUALITY = 0.8;

/** Where the pictures used to live, before there was one folder for everything. */
const LEGACY_PHOTO_DIR = 'student-photos';

export type PhotoSource = 'camera' | 'library';

/** Where this student's picture lives on the device. */
export function photoFile(studentId: string): File {
  const name = `${studentId}.jpg`;
  const destination = new File(photoDirectory(), name);

  // Brought across the first time this student's picture is asked for, rather
  // than sweeping the whole folder at startup: a teacher with sixty students
  // should not pay for sixty file moves before the first screen draws, and the
  // ones nobody looks at move the next time a sync or an export walks the list.
  moveIfPresent(new File(Paths.document, LEGACY_PHOTO_DIR, name), destination);

  return destination;
}

function photoDirectory(): Directory {
  return photosDirectory();
}

/** A `file://` URI for the picture, or null when there is none. */
export function photoUri(studentId: string): string | null {
  try {
    const file = photoFile(studentId);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Ask for the permission this source needs, at the moment it is needed.
 *
 * Not at startup: an app that asks for the camera the first time it opens
 * reads as something to uninstall, and Android stops showing the dialog after
 * two refusals — so the one chance to ask has to be the one where the reason
 * is on screen.
 */
export async function requestPhotoPermission(source: PhotoSource): Promise<boolean> {
  const picker = imagePicker();
  const result =
    source === 'camera'
      ? await picker.requestCameraPermissionsAsync()
      : await picker.requestMediaLibraryPermissionsAsync();
  return result.granted;
}

/**
 * Take or choose a picture, shrink it, and store it against the student.
 *
 * Returns the file URI, or null if the teacher backed out. Throws only when
 * something actually failed, so the caller can tell "changed their mind" from
 * "the camera would not open" — two outcomes that deserve very different
 * responses on screen.
 */
export async function capturePhoto(studentId: string, source: PhotoSource): Promise<string | null> {
  const options: ImagePickerOptionsSubset = {
    mediaTypes: 'images',
    allowsEditing: true,
    // Square, because that is how it is shown everywhere in the app. Cropping
    // here beats cropping at display time, where the top of somebody's head
    // disappears and nobody can work out why.
    aspect: [1, 1],
    // Full quality out of the picker; the compression below is ours to control
    // and applying it twice only loses detail for no further saving.
    quality: 1,
  };

  const picker = imagePicker();
  const result =
    source === 'camera'
      ? await picker.launchCameraAsync(options)
      : await picker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return null;

  const original = result.assets[0].uri;
  return storeOptimised(studentId, original);
}

type ImagePickerOptionsSubset = {
  mediaTypes: 'images';
  allowsEditing: boolean;
  aspect: [number, number];
  quality: number;
};

/**
 * Resize, re-encode, and put it where it belongs.
 *
 * Split out from `capturePhoto` because import restores photos too, and a
 * picture arriving from another device should be held to the same size rules
 * as one taken here.
 */
export async function storeOptimised(studentId: string, sourceUri: string): Promise<string> {
  const { ImageManipulator, SaveFormat } = manipulator();
  const context = ImageManipulator.manipulate(sourceUri);
  // Only the width is given: passing both would stretch anything that is not
  // already square, and the picker has already cropped to square.
  context.resize({ width: MAX_EDGE });

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: QUALITY,
  });

  const directory = photoDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = photoFile(studentId);
  // Replacing, not appending: one picture per student, and the old one has no
  // further use the moment a new one is taken.
  if (destination.exists) destination.delete();

  const temporary = new File(saved.uri);
  await temporary.move(destination);

  // The manipulator writes to the cache directory. Moving it out is the tidy
  // thing, and also means the cache being cleared cannot take the photo.
  return destination.uri;
}

/** Forget a student's picture. Used when the teacher removes it, and on import. */
export function deletePhoto(studentId: string) {
  try {
    const file = photoFile(studentId);
    if (file.exists) file.delete();
  } catch {
    // A picture that will not delete is not worth interrupting anyone over.
  }
}

/** Base64 of the stored picture, for the export bundle. */
export async function readPhotoBase64(studentId: string): Promise<string | null> {
  try {
    const file = photoFile(studentId);
    if (!file.exists) return null;
    return await file.base64();
  } catch {
    return null;
  }
}

/** Write a picture back from an export bundle. */
export function writePhotoBase64(studentId: string, base64: string) {
  const directory = photoDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = photoFile(studentId);
  if (destination.exists) destination.delete();
  destination.create();
  destination.write(base64ToBytes(base64));
}

/**
 * Base64 to bytes without `Buffer` or `atob`.
 *
 * Hermes has neither. Doing it by hand is a dozen lines and avoids pulling in
 * a polyfill for one call site.
 */
function base64ToBytes(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(length);

  let byte = 0;
  let bits = 0;
  let index = 0;

  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value < 0) continue;
    byte = (byte << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (byte >> bits) & 0xff;
    }
  }

  return out.subarray(0, index);
}

/* -------------------------------------------------------------------------- */
/* The server's copy                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The object key for a student's picture.
 *
 * The teacher's id has to be the first segment: the storage policy from
 * migration 0010 reads exactly that segment to decide who may touch the file.
 */
export const photoStoragePath = (teacherId: string, studentId: string) =>
  `${teacherId}/students/${studentId}.jpg`;

/**
 * Send this student's picture up, and report where it landed.
 *
 * Upserted rather than inserted, because a teacher who retakes a photo is
 * replacing one, and a second object under a suffixed name would leave the old
 * face in storage forever.
 */
export async function uploadPhoto(studentId: string): Promise<string> {
  const { data: auth } = await supabase.auth.getSession();
  const teacherId = auth.session?.user?.id;
  if (!teacherId) throw new Error('Not signed in');

  const file = photoFile(studentId);
  if (!file.exists) throw new Error('No photo on this device');

  // Bytes rather than the `File`: it satisfies the Blob interface but is not
  // `instanceof Blob`, and supabase-js decides how to send a body with an
  // `instanceof` check — so handing it over directly uploads "[object Object]".
  const bytes = await file.bytes();
  const path = photoStoragePath(teacherId, studentId);

  const { error } = await supabase.storage
    .from('attachments')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);

  return path;
}

/**
 * Fetch a picture this device does not have yet.
 *
 * This is what makes a second phone — or a reinstall — show faces again. The
 * download is skipped when the file is already there, so the common case costs
 * nothing.
 */
export async function downloadPhoto(studentId: string, path: string): Promise<boolean> {
  if (photoFile(studentId).exists) return false;

  const { data, error } = await supabase.storage.from('attachments').download(path);
  if (error || !data) return false;

  const buffer = await data.arrayBuffer();
  const directory = photoDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = photoFile(studentId);
  destination.create();
  destination.write(new Uint8Array(buffer));
  return true;
}

/**
 * Pull down every picture this device is missing.
 *
 * Deliberately sequential and deliberately quiet. It runs after a sync on a
 * connection that may be poor, nothing on screen is waiting for it, and a
 * failure means one face is missing rather than anything being wrong.
 */
export async function syncMissingPhotos(
  students: { id: string; photoPath?: string }[],
): Promise<number> {
  let fetched = 0;
  for (const student of students) {
    if (!student.photoPath) continue;
    try {
      if (await downloadPhoto(student.id, student.photoPath)) fetched += 1;
    } catch {
      // Next student. A missing picture is not worth abandoning the rest for.
    }
  }
  return fetched;
}
