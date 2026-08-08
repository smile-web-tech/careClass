/**
 * Files on messages — picking them, checking them, and getting them into
 * Supabase Storage.
 *
 * The file never travels through the Edge Function. The teacher uploads once
 * from their phone, the function is handed only the storage path, and it signs
 * a short-lived URL that Resend fetches for itself. On a Turkmen mobile
 * connection that is the difference between one upload and two, and it keeps
 * a 10 MB PDF away from a request body limit measured in single megabytes.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

/** Matches `file_size_limit` on the bucket in migration 0010. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;
/**
 * Resend caps a whole email at 40 MB and base64 inflates by a third, so this
 * leaves comfortable room for the body and headers.
 */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * Mirrors `allowed_mime_types` on the bucket. Kept in step by hand — a file the
 * client accepts and storage rejects fails at upload with an opaque message,
 * which is a worse experience than being told at the picker.
 */
export const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/gif',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Last-resort mapping for a picker that hands back no content type. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type PickedAttachment = {
  /** Local only, for React keys and removal. */
  id: string;
  /**
   * The picker's own `File`, held rather than rebuilt from its URI.
   *
   * On Android the picker hands back a `content://` URI from the Storage
   * Access Framework, and `new File('content://…')` is not the same thing as
   * the handle the picker opened — the permission grant rides on the object.
   * Reconstructing it was how uploading an assignment failed after the file
   * had been chosen and shown.
   */
  file: File;
  filename: string;
  mimeType: string;
  size: number;
};

export type UploadedAttachment = {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** Why a chosen file was not accepted. Keys into the `attach.reject*` strings. */
export type RejectReason = 'tooBig' | 'type' | 'tooMany' | 'empty';

export type PickOutcome = {
  accepted: PickedAttachment[];
  rejected: { filename: string; reason: RejectReason }[];
};

const mimeOf = (file: File): string => {
  const declared = file.type?.trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'application/octet-stream';
};

/**
 * Storage keys travel through URLs and signatures, so anything outside this set
 * is asking for trouble. The teacher still sees the original name — it is sent
 * to Resend as `filename` and is what lands in the recipient's inbox.
 */
const safeKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-80) || 'file';

/**
 * Open the system picker.
 *
 * `expo-file-system`'s own picker rather than `expo-document-picker`: it hands
 * back a `File`, which already knows its size and can produce bytes, so there
 * is no second round trip to stat the thing before deciding whether to accept
 * it. Images and documents come from the same sheet, which is also one fewer
 * decision for the teacher.
 */
export async function pickAttachments(alreadyPicked: number): Promise<PickOutcome> {
  const result = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ALLOWED_MIME });
  if (result.canceled) return { accepted: [], rejected: [] };

  const accepted: PickedAttachment[] = [];
  const rejected: PickOutcome['rejected'] = [];

  for (const file of result.result) {
    const filename = file.name;

    if (accepted.length + alreadyPicked >= MAX_FILES) {
      rejected.push({ filename, reason: 'tooMany' });
      continue;
    }

    const size = file.size ?? 0;
    if (size <= 0) {
      rejected.push({ filename, reason: 'empty' });
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      rejected.push({ filename, reason: 'tooBig' });
      continue;
    }

    const mimeType = mimeOf(file);
    if (!ALLOWED_MIME.includes(mimeType)) {
      rejected.push({ filename, reason: 'type' });
      continue;
    }

    accepted.push({
      id: `${Date.now()}-${accepted.length}-${filename}`,
      file,
      filename,
      mimeType,
      size,
    });
  }

  return { accepted, rejected };
}

/**
 * Upload everything, reporting progress a file at a time.
 *
 * Bytes are read into an `ArrayBuffer` rather than passing the `File` straight
 * through: `expo-file-system`'s `File` satisfies the `Blob` interface but is
 * not `instanceof Blob`, and supabase-js decides how to send a body with an
 * `instanceof` check — so handing it the file directly uploads the string
 * `[object Object]`.
 *
 * Throws on the first failure. A half-uploaded set is not something to send:
 * the teacher would be told the homework went out with the wrong files on it.
 */
export async function uploadAttachments(
  picked: PickedAttachment[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadedAttachment[]> {
  const { data: auth } = await supabase.auth.getUser();
  const teacherId = auth.user?.id;
  if (!teacherId) throw new Error('Not signed in');

  // `expo-crypto`, not the global `crypto`. Hermes has no Web Crypto, so
  // `crypto.randomUUID()` is a ReferenceError on device — and this line only
  // runs once a file has been picked, so it broke the send rather than the
  // screen and nothing caught it before a real upload.
  const batch = Crypto.randomUUID();
  const uploaded: UploadedAttachment[] = [];

  for (const item of picked) {
    // Named stages. "Could not upload" on its own sent us hunting through the
    // proxy, the bucket policy and the picker in turn; the message now says
    // which of the two things failed and for which file.
    let bytes: ArrayBuffer;
    try {
      bytes = await item.file.arrayBuffer();
    } catch (e) {
      throw new Error(
        `Could not read "${item.filename}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // The first path segment is the whole access rule — see the storage policy
    // in migration 0010.
    const storagePath = `${teacherId}/outgoing/${batch}/${safeKey(item.filename)}`;

    const { error } = await supabase.storage
      .from('attachments')
      .upload(storagePath, bytes, { contentType: item.mimeType, upsert: false });
    if (error) {
      throw new Error(`Could not upload "${item.filename}" (${item.mimeType}): ${error.message}`);
    }

    uploaded.push({
      storagePath,
      filename: item.filename,
      mimeType: item.mimeType,
      size: item.size,
    });
    onProgress?.(uploaded.length, picked.length);
  }

  return uploaded;
}

/**
 * A link the teacher can open to see what a student sent back.
 *
 * Signed rather than public, and short-lived: a homework photo of somebody's
 * child is not something to leave on a guessable URL.
 */
export async function signedAttachmentUrl(storagePath: string, seconds = 3600) {
  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

/** "2.4 MB" — for the chip under a picked file. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
