/**
 * Where ClassCare keeps its files.
 *
 * One folder, `ClassCare`, with everything the app owns inside it: the
 * database, the student photos, and the backups it writes. Before this the
 * database sat in the SQLite directory the library picked, the photos in a
 * `student-photos` folder beside it, and exports in the cache — three places
 * with no relationship to each other, which is fine until somebody has to
 * answer "where is my data".
 *
 * ```
 * ClassCare/
 *   classcare.db      the whole account, plus -wal and -shm while it is open
 *   photos/           one JPEG per student, named by id
 *   backups/          .classcare exports, newest kept
 * ```
 *
 * ## What this folder is not
 *
 * It is inside the app's private documents directory, which on Android is not
 * visible to a file manager and is removed when the app is uninstalled. That is
 * the only place an app can write freely without asking for storage access, and
 * asking would be a permission prompt for something the teacher gains nothing
 * from. Getting a file *out* is what the export share sheet is for — that hands
 * the backup to WhatsApp, Bluetooth, Drive or Files, wherever they want it.
 */
import { Directory, File, Paths } from 'expo-file-system';

export const APP_FOLDER = 'ClassCare';

/** `…/ClassCare`, created on first use. */
export function appDirectory(): Directory {
  return ensure(new Directory(Paths.document, APP_FOLDER));
}

/** `…/ClassCare/photos` — student pictures, one per id. */
export function photosDirectory(): Directory {
  return ensure(new Directory(appDirectory(), 'photos'));
}

/** `…/ClassCare/backups` — exported `.classcare` files. */
export function backupsDirectory(): Directory {
  return ensure(new Directory(appDirectory(), 'backups'));
}

function ensure(directory: Directory): Directory {
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/**
 * Move a file into its new home, once.
 *
 * Used by the two callers that had files somewhere else before this folder
 * existed. Returns whether anything moved, and swallows failures on purpose:
 * a photo that will not move is one missing face, and throwing here would
 * happen during startup and take the whole app with it.
 */
export function moveIfPresent(from: File, to: File): boolean {
  try {
    if (!from.exists) return false;
    if (to.exists) {
      // Already migrated and the old copy lingered. The new one wins — it is
      // the one the app has been writing to.
      from.delete();
      return false;
    }
    from.move(to);
    return true;
  } catch {
    return false;
  }
}
