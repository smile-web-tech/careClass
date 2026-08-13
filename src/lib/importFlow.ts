/**
 * Taking a `.classcare` file and putting it into this account.
 *
 * Two ways in, one path through. The teacher can pick a file from Settings, or
 * tap one in Downloads, WhatsApp or a file manager and choose ClassCare — and
 * both have to ask the same question, in the same words, before replacing a
 * term of work.
 *
 * The gate is the account. An import writes into whichever account is signed in
 * on this device, so doing it with nobody signed in would either fill a blank
 * install with data belonging to a teacher who is not there, or worse, file it
 * under whoever signs in next. A file that arrives before sign-in is held, and
 * offered again the moment there is somebody to offer it to.
 */
import { File } from 'expo-file-system';

import { showAlert, showDialog, showError } from '@/components/Dialog';
import { applyBackup, BackupError, mergeBackup, readBackup, summarise } from '@/data/backup';
import { useStore } from '@/data/store';
import { pushImported } from '@/data/sync';
import type { TranslationKey } from '@/i18n';
import { translateNow } from '@/i18n/useT';

/** Why a chosen file could not be read, in words rather than in a code. */
const BACKUP_ERROR_KEY: Record<BackupError['reason'], TranslationKey> = {
  notJson: 'backup.errorNotJson',
  notBackup: 'backup.errorNotBackup',
  tooNew: 'backup.errorTooNew',
  empty: 'backup.errorEmpty',
};

/* -------------------------------------------------------------------------- */
/* A file waiting for somebody to sign in                                     */
/* -------------------------------------------------------------------------- */

let held: string | null = null;

/** True while a confirmation is on screen, so a repeated tap cannot stack. */
let running = false;

/** Keep a file until there is an account to import it into. */
export const holdImport = (uri: string) => {
  held = uri;
};

/** Take the waiting file, if there is one. Clears it either way. */
export const takeHeldImport = () => {
  const uri = held;
  held = null;
  return uri;
};

/**
 * Whether this URL is a file rather than one of the app's own links.
 *
 * The same listener sees OAuth callbacks and password-recovery links on the
 * `classcare://` scheme, and those must fall through untouched.
 */
export const looksLikeBackupUrl = (url: string) =>
  url.startsWith('file://') || url.startsWith('content://');

/* -------------------------------------------------------------------------- */
/* The import itself                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Show what is in the file, and let the teacher choose what happens to it.
 *
 * Two ways in, because there are two real situations. Restoring your own phone
 * means replacing what is here. Being sent a colleague's class, or pulling last
 * year's students back, means adding to it — and losing this term's groups to
 * do that would be indefensible.
 *
 * Adding keeps whatever is already on the device wherever the two files
 * describe the same row, so nothing entered here is overwritten by something
 * older. See `mergeBackup`.
 */
export async function importFromFile(file: File): Promise<void> {
  if (!useStore.getState().signedIn) {
    await showAlert(t('backup.import'), t('backup.signInFirst'), 'danger');
    return;
  }

  /*
    One at a time.

    A cold start can deliver the same tap twice — once as the URL that launched
    the app and once as a `url` event — and two confirmations stacked on each
    other, both offering to replace everything, is alarming whichever one the
    teacher answers.
  */
  if (running) return;
  running = true;

  try {
    const backup = await readBackup(file);
    const summary = summarise(backup);

    const choice = await showDialog({
      title: t('backup.importTitle'),
      message: t('backup.importSummary', {
        groups: summary.groups,
        students: summary.students,
        photos: summary.photos,
        date: summary.exportedAt.slice(0, 10),
      }),
      tone: 'info',
      actions: [
        // Adding first, and it is the one that reads as safe, because it is:
        // nothing already on the phone is touched.
        { label: t('backup.importMerge'), value: 'merge', intent: 'primary' },
        { label: t('backup.importReplace'), value: 'replace', intent: 'danger' },
        { label: t('common.cancel'), value: 'cancel', intent: 'quiet' },
      ],
    });
    if (choice !== 'merge' && choice !== 'replace') return;

    if (choice === 'merge') await mergeBackup(backup);
    else await applyBackup(backup);

    /*
      And up to the server.

      An import that only lands locally is undone by the next sync: `hydrate`
      pulls the account's rows over the top and the imported classes disappear,
      minutes after the app said the import had worked.
    */
    pushImported();

    await showAlert(
      t('backup.imported'),
      t(choice === 'merge' ? 'backup.mergedBody' : 'backup.importedBody', {
        students: summary.students,
      }),
      'success',
    );
  } catch (e) {
    if (e instanceof BackupError) {
      await showAlert(t('backup.importFailed'), t(BACKUP_ERROR_KEY[e.reason]), 'danger');
    } else {
      showError(e, t('backup.importFailed'));
    }
  } finally {
    running = false;
  }
}

/**
 * The same, for a file Android handed us by URI.
 *
 * Held rather than refused when nobody is signed in: the teacher tapped the
 * file on purpose, and losing that intent because they had not signed in yet
 * would mean finding the file again afterwards.
 */
export async function importFromUri(uri: string): Promise<void> {
  if (!useStore.getState().signedIn) {
    holdImport(uri);
    return;
  }

  try {
    await importFromFile(new File(uri));
  } catch (e) {
    showError(e, t('backup.importFailed'));
  }
}

/** Non-hook translation, because this runs from the root layout and dialogs. */
const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
  translateNow(key, vars);
