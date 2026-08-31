/**
 * The spreadsheet buttons: writing one out, reading one in, and the sample.
 *
 * Kept apart from `data/studentsSheet`, which knows about columns, quoting and
 * zip parts and nothing about files or dialogs. This is the half that touches
 * the disk and talks to the teacher, so the two can be reasoned about — and the
 * parsing tested — separately.
 *
 * What goes out is `.xlsx`, always. What comes in may be either that or a
 * `.csv`, because the list a teacher already has was as likely exported by a
 * school system as saved out of Excel.
 */
import { File } from 'expo-file-system';

import { showAlert, showDialog, showError } from '@/components/Dialog';
import { useStore } from '@/data/store';
import {
  applyStudentSheet,
  rowsFromFile,
  sampleStudentsXlsx,
  SheetError,
  studentsFromRows,
  studentsToXlsx,
} from '@/data/studentsSheet';
import type { TranslationKey } from '@/i18n';
import { translateNow } from '@/i18n/useT';
import { backupsDirectory } from '@/lib/appFolder';
import { NoFilePicker, pickOneFile } from '@/lib/filePicker';

const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
  translateNow(key, vars);

/** Why a chosen spreadsheet could not be read, in words rather than a code. */
const SHEET_ERROR_KEY: Record<SheetError['reason'], TranslationKey> = {
  empty: 'csv.errorEmpty',
  noName: 'csv.errorNoName',
  unreadable: 'csv.errorUnreadable',
};

/* -------------------------------------------------------------------------- */
/* Writing a file out                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Put a CSV in the app's folder and offer it to the share sheet.
 *
 * The file is written either way, so a phone with no share sheet — a stripped
 * ROM, a locked-down handset — still ends up with the spreadsheet and is told
 * where it is, rather than being shown a failure for something that worked.
 */
async function writeAndShare(name: string, contents: Uint8Array, doneTitle: TranslationKey) {
  const file = new File(backupsDirectory(), name);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  /*
    Loaded on use, not imported at the top.

    An Expo module resolves its native half at import time, so a top-level
    import here would crash every screen that touches this file on a build made
    before the package was added. Failing on the button keeps the rest working.
  */
  let Sharing: typeof import('expo-sharing');
  try {
    Sharing = require('expo-sharing') as typeof import('expo-sharing');
  } catch {
    await showAlert(t(doneTitle), t('backup.savedTo', { path: file.uri }));
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    await showAlert(t(doneTitle), t('backup.savedTo', { path: file.uri }));
    return;
  }

  await Sharing.shareAsync(file.uri, {
    // The workbook type, so the share sheet offers Excel, Sheets and Drive
    // rather than the text editors a generic type attracts.
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: t(doneTitle),
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  });
}

/** Every student on this device, as an Excel workbook. */
export async function exportStudentsSheet(): Promise<void> {
  try {
    const { students, groups } = useStore.getState();
    const stamp = new Date().toISOString().slice(0, 10);
    await writeAndShare(
      `ClassCare-students-${stamp}.xlsx`,
      studentsToXlsx(students, groups),
      'csv.exported',
    );
  } catch (e) {
    showError(e, t('csv.failedTitle'));
  }
}

/** The sample workbook, for a teacher starting from nothing. */
export async function shareSheetTemplate(): Promise<void> {
  try {
    await writeAndShare('ClassCare-template.xlsx', sampleStudentsXlsx(), 'csv.template');
  } catch (e) {
    showError(e, t('csv.failedTitle'));
  }
}

/* -------------------------------------------------------------------------- */
/* Reading one in                                                             */
/* -------------------------------------------------------------------------- */

/** True while a confirmation is on screen, so a repeated tap cannot stack. */
let running = false;

/**
 * Pick a spreadsheet and put its students into the account.
 *
 * The two ways in are the same two the backup import offers, in the same words,
 * because they are the same question: add these to what is here, or let this
 * file become the roster. Replacing is still the danger action and still says
 * so — it removes students the file leaves out — but a student the file *does*
 * carry is edited rather than rebuilt, so they keep their photograph and their
 * colour. A picture is not in a spreadsheet and cannot come back from one.
 */
export async function importStudentsSheet(): Promise<void> {
  if (!useStore.getState().signedIn) {
    await showAlert(t('csv.import'), t('backup.signInFirst'), 'danger');
    return;
  }
  if (running) return;
  running = true;

  try {
    const picked = await pickOneFile([
      // The wildcard alongside the specific types because Android file managers
      // routinely hand a spreadsheet over as `application/octet-stream`, and a
      // filter that excludes it makes the teacher's own file unpickable.
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/comma-separated-values',
      '*/*',
    ]);
    if (picked.canceled) return;

    // Bytes rather than text: a workbook is a zip, and decoding one as UTF-8
    // to hand back a string would corrupt it before anything could read it.
    const parsed = studentsFromRows(rowsFromFile(await picked.result.bytes()));

    const choice = await showDialog({
      title: t('csv.importTitle'),
      message: t('csv.importSummary', { count: parsed.length }),
      tone: 'info',
      actions: [
        { label: t('csv.merge'), value: 'merge', intent: 'primary' },
        { label: t('csv.replace'), value: 'replace', intent: 'danger' },
        { label: t('common.cancel'), value: 'cancel', intent: 'quiet' },
      ],
    });
    if (choice !== 'merge' && choice !== 'replace') return;

    const outcome = await applyStudentSheet(parsed, choice);

    const lines = [
      choice === 'replace'
        ? t('csv.replacedBody', {
            added: outcome.added,
            updated: outcome.updated,
            removed: outcome.removed,
          })
        : t('csv.importedBody', { added: outcome.added, updated: outcome.updated }),
      // Said out loud, because it is the one number that disagrees with the
      // file: a replace that kept somebody the file left out has to explain
      // itself, or it looks like the import half worked.
      outcome.keptForHistory
        ? t('csv.keptHistory', { count: outcome.keptForHistory })
        : '',
      // What the Groups column did, when the file had one. Said out loud
      // because creating a class is the one thing an import does that the
      // teacher did not ask for by name, and they should find it in the list
      // rather than discover it.
      outcome.groupsCreated ? t('csv.groupsMade', { count: outcome.groupsCreated }) : '',
      outcome.joined ? t('csv.groupsJoined', { count: outcome.joined }) : '',
      /*
        Only where the file said nothing about classes.

        A teacher whose file *did* carry the column has just been told what it
        did, and telling them in the same breath that their students are in no
        class would be telling them something untrue.
      */
      outcome.added && !outcome.joined ? t('csv.assignGroups') : '',
    ].filter(Boolean);

    await showAlert(t('csv.imported'), lines.join('\n\n'), 'success');
  } catch (e) {
    /*
      A platform with no picker is not a bad spreadsheet.

      `offerTemplate` says "we could not read that file, here is one that
      works", which is the right thing to say about a file and a misleading
      thing to say when no file was ever chosen.
    */
    if (e instanceof NoFilePicker) await showAlert(t('csv.import'), e.message, 'danger');
    else await offerTemplate(e);
  } finally {
    running = false;
  }
}

/**
 * Say what was wrong with the file, and hand over one that is right.
 *
 * "Could not read that file" on its own leaves the teacher guessing at column
 * names. They guess wrong, try again, and stop trying. Offering the sample from
 * inside the failure turns the dead end into the next step.
 */
async function offerTemplate(error: unknown) {
  const reason =
    error instanceof SheetError ? t(SHEET_ERROR_KEY[error.reason]) : t('csv.errorUnreadable');

  const choice = await showDialog({
    title: t('csv.failedTitle'),
    message: `${reason}\n\n${t('csv.useTemplate')}`,
    tone: 'danger',
    actions: [
      { label: t('csv.getTemplate'), value: 'template', intent: 'primary' },
      { label: t('common.cancel'), value: 'cancel', intent: 'quiet' },
    ],
  });

  if (choice === 'template') await shareSheetTemplate();
}
