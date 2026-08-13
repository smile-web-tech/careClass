/**
 * Moving a teacher's whole ClassCare to another phone.
 *
 * The server is one way to do that and it is not always available — a teacher
 * with no data bundle left, a school with no connection, a phone being replaced
 * on a Sunday. A file they can send over Bluetooth, WhatsApp or a memory card
 * is the other way, and it does not depend on anybody's infrastructure.
 *
 * ## The format
 *
 * One JSON file with the extension `.classcare`. It carries a `format` marker
 * and a `version`, both checked on import: a file from a newer app is refused
 * with a message that says so rather than being half-read into a broken state.
 *
 * Photos travel as base64 inside the same file. That inflates them by a third,
 * which for pictures already squeezed to about 40 KB is a price worth paying
 * for a backup that is one file — a folder of loose images is a folder that
 * arrives incomplete.
 *
 * ## What it deliberately does not carry
 *
 * The account. A backup is the teacher's data, not their session: importing it
 * on another phone should put their classes there, not sign anyone in. It also
 * omits the outbox, because unsent writes belong to the device that made them
 * and replaying them from a second phone would send everything twice.
 */
import { Directory, File } from 'expo-file-system';

import { backupsDirectory } from '@/lib/appFolder';
import { useStore } from '@/data/store';
import { flushAll } from '@/data/persistence';
import type {
  Assessment,
  AssessmentType,
  AttendanceRecord,
  CalendarEvent,
  Grade,
  Group,
  Message,
  MessageTemplate,
  Reply,
  Student,
} from '@/data/types';
import { deletePhoto, readPhotoBase64, writePhotoBase64 } from '@/lib/studentPhoto';

export const BACKUP_FORMAT = 'classcare-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = 'classcare';

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO 8601, for the file name and for the confirmation before importing. */
  exportedAt: string;
  /** Whose it is. Shown before importing, never used to sign anybody in. */
  teacher: { name: string; email: string | null };
  data: {
    groups: Group[];
    students: Student[];
    attendance: Record<string, AttendanceRecord>;
    messages: Message[];
    replies: Reply[];
    events: CalendarEvent[];
    assessments: Assessment[];
    assessmentTypes: AssessmentType[];
    grades: Grade[];
    templates: MessageTemplate[];
    gradeTemplate: string | null;
  };
  /** Base64 JPEG per student id. Absent students simply have no picture. */
  photos: Record<string, string>;
};

export type BackupSummary = {
  exportedAt: string;
  teacherName: string;
  groups: number;
  students: number;
  photos: number;
  assessments: number;
};

/** What a teacher is about to overwrite, or about to take with them. */
export function summarise(backup: Backup): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    teacherName: backup.teacher.name,
    groups: backup.data.groups.length,
    students: backup.data.students.length,
    photos: Object.keys(backup.photos).length,
    assessments: backup.data.assessments.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/** `ClassCare-2026-08-09.classcare` — sorts by date and says what it is. */
function fileName(date: Date) {
  const stamp = date.toISOString().slice(0, 10);
  return `ClassCare-${stamp}.${BACKUP_EXTENSION}`;
}

/**
 * Write the whole account to a file and return it.
 *
 * The local database is flushed first. Without that, a change made in the last
 * few hundred milliseconds is still sitting in the write buffer and the export
 * would quietly be one edit out of date — the kind of bug nobody finds until
 * they are restoring on a new phone and something is missing.
 */
export async function exportBackup(): Promise<File> {
  await flushAll();

  const state = useStore.getState();

  const photos: Record<string, string> = {};
  for (const student of state.students) {
    const base64 = await readPhotoBase64(student.id);
    if (base64) photos[student.id] = base64;
  }

  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    teacher: { name: state.teacherName, email: state.teacherEmail },
    data: {
      groups: state.groups,
      students: state.students,
      attendance: state.attendance,
      messages: state.messages,
      replies: state.replies,
      events: state.events,
      assessments: state.assessments,
      assessmentTypes: state.assessmentTypes,
      grades: state.grades,
      templates: state.templates,
      gradeTemplate: state.gradeTemplate,
    },
    photos,
  };

  // `ClassCare/backups`, not the cache. An export written to the cache is a
  // file the OS may delete the moment storage runs low, which is exactly when a
  // teacher goes looking for it. Kept here it survives, and the share sheet
  // still hands a copy to wherever they actually want it.
  const directory = backupsDirectory();

  const file = new File(directory, fileName(new Date()));
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup));

  pruneBackups(directory);
  return file;
}

/** How many exports the folder keeps. Older ones are the teacher's to re-make. */
const KEEP_BACKUPS = 5;

/**
 * Keep the newest few and delete the rest.
 *
 * A backup a day for a term is a term of duplicated photos on a phone that is
 * usually short of space. Five is enough to go back to a known-good copy after
 * a bad import, which is the only reason to keep more than one.
 */
function pruneBackups(directory: Directory) {
  try {
    const files = directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .filter((f) => f.name.endsWith(`.${BACKUP_EXTENSION}`))
      // The name carries the date, so sorting by it is sorting by age. Reverse
      // alphabetical puts the newest first.
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const old of files.slice(KEEP_BACKUPS)) old.delete();
  } catch {
    // A folder that will not list is not a reason to fail an export that has
    // already been written.
  }
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export class BackupError extends Error {
  constructor(
    /** A key into the `backup.*` strings, so the screen can translate it. */
    readonly reason: 'notJson' | 'notBackup' | 'tooNew' | 'empty',
  ) {
    super(reason);
  }
}

/**
 * Read and check a file the teacher chose, without applying any of it.
 *
 * Separate from `applyBackup` on purpose: nothing should be overwritten until
 * the teacher has been told what is in the file and what it will replace.
 */
export async function readBackup(file: File): Promise<Backup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new BackupError('notJson');
  }

  const backup = parsed as Partial<Backup>;
  if (!backup || backup.format !== BACKUP_FORMAT || !backup.data) {
    throw new BackupError('notBackup');
  }
  if (typeof backup.version === 'number' && backup.version > BACKUP_VERSION) {
    // A file written by a newer app. Reading it half-way is worse than
    // refusing: it would drop whatever this version does not know about and
    // the teacher would never know which parts.
    throw new BackupError('tooNew');
  }
  if (!Array.isArray(backup.data.students) || !Array.isArray(backup.data.groups)) {
    throw new BackupError('empty');
  }

  return {
    format: BACKUP_FORMAT,
    version: backup.version ?? 1,
    exportedAt: backup.exportedAt ?? '',
    teacher: backup.teacher ?? { name: '', email: null },
    data: {
      groups: backup.data.groups ?? [],
      students: backup.data.students ?? [],
      attendance: backup.data.attendance ?? {},
      messages: backup.data.messages ?? [],
      replies: backup.data.replies ?? [],
      events: backup.data.events ?? [],
      assessments: backup.data.assessments ?? [],
      assessmentTypes: backup.data.assessmentTypes ?? [],
      grades: backup.data.grades ?? [],
      templates: backup.data.templates ?? [],
      gradeTemplate: backup.data.gradeTemplate ?? null,
    },
    photos: backup.photos ?? {},
  };
}

/**
 * Replace everything on this device with the contents of the backup.
 *
 * Replace, not merge. Merging two copies of the same class means deciding
 * which version of a mark is right, and there is no honest way to do that
 * without asking about every difference. Replacing is a thing the teacher can
 * predict, which is why the confirmation says so plainly.
 *
 * The pictures are written first. If something fails part-way, a student with
 * a photo and no row is invisible, while a row with no photo is a student the
 * teacher can see is missing their picture.
 */
export async function applyBackup(backup: Backup): Promise<void> {
  const previous = useStore.getState().students;

  for (const student of previous) deletePhoto(student.id);

  for (const [studentId, base64] of Object.entries(backup.photos)) {
    try {
      writePhotoBase64(studentId, base64);
    } catch {
      // One unreadable picture must not stop the import. The student arrives
      // with initials instead of a face, which is recoverable by hand.
    }
  }

  useStore.setState({
    groups: backup.data.groups,
    students: backup.data.students,
    attendance: backup.data.attendance,
    messages: backup.data.messages,
    replies: backup.data.replies,
    events: backup.data.events,
    assessments: backup.data.assessments,
    assessmentTypes: backup.data.assessmentTypes,
    grades: backup.data.grades,
    templates: backup.data.templates,
    gradeTemplate: backup.data.gradeTemplate,
  });

  // Straight to disk rather than waiting for the debounce: the teacher may
  // well close the app the moment the "imported" dialog is dismissed.
  await flushAll();
}
