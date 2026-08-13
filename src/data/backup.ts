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
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';

import { backupsDirectory } from '@/lib/appFolder';
import { readSetting, writeSetting } from '@/data/localDb';
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
    /*
      The three below arrived after the format did, and are optional for that
      reason: a file written by an older build simply does not have them, and
      reading one must not fail over it. Nothing here needs a version bump —
      that is for changes an older app would misread, not for fields it will
      ignore.
    */
    /** The wording sent when a student did not pass. */
    gradeTemplateFail?: string | null;
    /** Rewrites of the built-in templates, keyed by the template's id. */
    templateOverrides?: Record<string, { title: string; body: string }>;
    /** Built-in templates the teacher took off the list. */
    hiddenTemplates?: string[];
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

/**
 * `ClassCare-2026-08-09.classcare.json` — sorts by date and says what it is.
 *
 * Both halves of that suffix earn their place. `.classcare` is the identity, so
 * a teacher scrolling a Downloads folder knows what they are looking at. The
 * trailing `.json` is what makes tapping it work: Android matches a file to an
 * app by MIME type, file managers derive that type from the last extension, and
 * an unknown one arrives as `application/octet-stream` — a type ClassCare must
 * not claim, or it would offer itself for every unrecognised file on the phone.
 */
function fileName(date: Date) {
  const stamp = date.toISOString().slice(0, 10);
  return `ClassCare-${stamp}${BACKUP_SUFFIX}`;
}

/** What an export is called from the dot onwards. */
export const BACKUP_SUFFIX = `.${BACKUP_EXTENSION}.json`;

/** True for anything this app wrote, including the older bare `.classcare`. */
export const isBackupFileName = (name: string) =>
  name.endsWith(BACKUP_SUFFIX) || name.endsWith(`.${BACKUP_EXTENSION}`);

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
      gradeTemplateFail: state.gradeTemplateFail,
      templateOverrides: state.templateOverrides,
      hiddenTemplates: state.hiddenTemplates,
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
      .filter((f) => isBackupFileName(f.name))
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
      gradeTemplateFail: backup.data.gradeTemplateFail ?? null,
      templateOverrides: backup.data.templateOverrides ?? {},
      hiddenTemplates: backup.data.hiddenTemplates ?? [],
    },
    photos: backup.photos ?? {},
  };
}

/* -------------------------------------------------------------------------- */
/* Making the file this account's own                                         */
/* -------------------------------------------------------------------------- */

/**
 * The ids this device has already handed out to rows from earlier imports.
 *
 * Kept so importing the same file twice lands on the same rows instead of a
 * second copy of every student. Grows by one entry per imported row and is
 * never read except here, so a teacher who imports a colleague's class once a
 * term will not notice it.
 */
const IMPORT_MAP_SETTING = 'importedIds';

/** Same generator the store uses, so imported rows are indistinguishable. */
const uid = () => Crypto.randomUUID();

/**
 * Give every row in the file an id this account is allowed to write.
 *
 * This is the difference between an import that works and one that appears to
 * work. A `.classcare` file carries the ids the *exporting* account minted, and
 * on the server those ids belong to that account: every row is protected by
 * `teacher_id = auth.uid()`. Writing them back under a different teacher is
 * refused — an upsert whose conflicting row is invisible to the policy raises
 * either "row level security" or "already exists", one per row, which is the
 * storm of errors an import used to produce. The rows still appeared on screen,
 * because they had been written locally first, and then vanished at the next
 * sync when `hydrate` pulled down the server's version — which had never
 * received them.
 *
 * So: an id that this account already holds is kept, because that is the same
 * row coming home — a teacher restoring their own backup, or re-importing a
 * file they have imported before. Everything else is given a fresh id, and
 * every reference to it is rewritten to match.
 *
 * References that point at nothing are dropped rather than repointed. A student
 * listing a group the file does not contain, a mark for a student who was
 * deleted before the export — those are already broken in the file, and sending
 * them to the server is a foreign key violation that takes the whole row with
 * it.
 */
export type Reowned = {
  backup: Backup;
  /**
   * Every id the file ends up owning, kept or freshly minted.
   *
   * Handed to `pushImported` so it can queue exactly the rows that arrived
   * rather than re-sending the whole account behind them.
   */
  ids: Set<string>;
};

export async function reownBackup(backup: Backup): Promise<Reowned> {
  const state = useStore.getState();

  const remembered = (await readSetting<Record<string, string>>(IMPORT_MAP_SETTING)) ?? {};
  const minted: Record<string, string> = {};

  /**
   * Work out the new id for every row of one kind.
   *
   * `mine` is what this account holds right now. Note this is read before
   * anything is applied, so it is still true for a replacing import.
   */
  const mapIds = (rows: { id: string }[], mine: Set<string>) => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (map.has(row.id)) continue;
      const next = mine.has(row.id) ? row.id : (remembered[row.id] ?? uid());
      map.set(row.id, next);
      if (next !== row.id) minted[row.id] = next;
    }
    return map;
  };

  const idsOf = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));

  /**
   * One row per id.
   *
   * A file listing the same id twice — hand-edited, or merged by someone with a
   * text editor — would otherwise become two rows the app cannot tell apart,
   * and the second write of the pair silently overwrites the first everywhere
   * afterwards. The first occurrence wins, which matches how a merge treats a
   * row it has already seen.
   */
  const unique = <T extends { id: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  };

  const groups = mapIds(backup.data.groups, idsOf(state.groups));
  const students = mapIds(backup.data.students, idsOf(state.students));
  const events = mapIds(backup.data.events, idsOf(state.events));
  const assessments = mapIds(backup.data.assessments, idsOf(state.assessments));
  const types = mapIds(backup.data.assessmentTypes, idsOf(state.assessmentTypes));
  const templates = mapIds(backup.data.templates, idsOf(state.templates));
  const messages = mapIds(backup.data.messages, idsOf(state.messages));
  const replies = mapIds(backup.data.replies, idsOf(state.replies));

  /** Grades carry no id of their own; they are keyed by the pair they join. */
  const gradeRows = backup.data.grades
    .map((g) => {
      const assessmentId = assessments.get(g.assessmentId);
      const studentId = students.get(g.studentId);
      return assessmentId && studentId ? { ...g, assessmentId, studentId } : null;
    })
    .filter((g): g is Grade => g !== null);

  /*
    Attendance hides two foreign keys inside its own key.

    `<groupId>@<YYYY-MM-DD>#<HH:MM>` is what the store uses and what the sync
    queue splits apart again, so the group id has to be rewritten in place.
  */
  const attendance: Record<string, AttendanceRecord> = {};
  for (const [key, record] of Object.entries(backup.data.attendance)) {
    const [oldGroupId, rest] = key.split('@');
    const groupId = groups.get(oldGroupId);
    if (!groupId || rest === undefined) continue;

    const marks: AttendanceRecord = {};
    for (const [oldStudentId, status] of Object.entries(record)) {
      const studentId = students.get(oldStudentId);
      if (studentId) marks[studentId] = status;
    }
    if (Object.keys(marks).length) attendance[`${groupId}@${rest}`] = marks;
  }

  const photos: Record<string, string> = {};
  for (const [oldStudentId, base64] of Object.entries(backup.photos)) {
    const studentId = students.get(oldStudentId);
    if (studentId) photos[studentId] = base64;
  }

  // Remember what was handed out, so the next import of this file recognises
  // these rows instead of duplicating them.
  if (Object.keys(minted).length) {
    await writeSetting(IMPORT_MAP_SETTING, { ...remembered, ...minted });
  }

  const ids = new Set<string>();
  for (const map of [groups, students, events, assessments, types, templates, messages, replies]) {
    for (const id of map.values()) ids.add(id);
  }

  const reowned: Backup = {
    ...backup,
    data: {
      ...backup.data,
      groups: unique(backup.data.groups.map((g) => ({ ...g, id: groups.get(g.id)! }))),

      /*
        `photoPath` is deliberately dropped.

        It names an object under the *exporting* teacher's folder in storage,
        which this account may not read, and it is keyed by the old student id
        besides. The picture itself travelled in the file and is written to the
        device; `pushImported` then queues an upload that puts it back in
        storage under this account, and the path comes from that.
      */
      students: unique(
        backup.data.students.map((s) => ({
          ...s,
          id: students.get(s.id)!,
          groupIds: [
            ...new Set(s.groupIds.map((id) => groups.get(id)).filter((id): id is string => !!id)),
          ],
          photoPath: undefined,
        })),
      ),
      attendance,
      // Only the message and the classes it went to. A `Message` keeps two
      // counts rather than a list of recipients, so there is nothing per-student
      // here to repoint.
      messages: unique(
        backup.data.messages.map((m) => ({
          ...m,
          id: messages.get(m.id)!,
          groupIds: [
            ...new Set(m.groupIds.map((id) => groups.get(id)).filter((id): id is string => !!id)),
          ],
        })),
      ),
      replies: unique(
        backup.data.replies.map((r) => ({
          ...r,
          id: replies.get(r.id)!,
          studentId: r.studentId ? students.get(r.studentId) : undefined,
        })),
      ),
      events: unique(backup.data.events.map((e) => ({ ...e, id: events.get(e.id)! }))),
      assessments: unique(
        backup.data.assessments
          .map((a) => {
            const groupId = groups.get(a.groupId);
            return groupId ? { ...a, id: assessments.get(a.id)!, groupId } : null;
          })
          .filter((a): a is Assessment => a !== null),
      ),
      assessmentTypes: unique(
        backup.data.assessmentTypes
          .map((t) => {
            const groupId = groups.get(t.groupId);
            return groupId ? { ...t, id: types.get(t.id)!, groupId } : null;
          })
          .filter((t): t is AssessmentType => t !== null),
      ),
      grades: gradeRows,
      templates: unique(backup.data.templates.map((t) => ({ ...t, id: templates.get(t.id)! }))),
    },
    photos,
  };

  return { backup: reowned, ids };
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
/**
 * Add the file's contents to what is already here, keeping both.
 *
 * The other half of `applyBackup`, and the one a teacher wants far more often:
 * a colleague sends a class, or last year's phone is restored onto this one,
 * and none of that should cost the groups already on the device.
 *
 * Matched on id, and only on id. Two rows with the same id are the same row —
 * an export and its origin — so the copy already here wins and the incoming one
 * is skipped: it is older by definition, and silently overwriting a mark
 * entered this morning with one from a file made last week is the worst thing
 * this function could do. Anything whose id is new is added.
 *
 * Deliberately not matched on name. Two students called Aýgül Berdiýewa in two
 * different teachers' files are two children, and merging them would put one
 * girl's marks on the other's report.
 */
export async function mergeBackup(backup: Backup): Promise<void> {
  const state = useStore.getState();

  /** Existing first, then anything from the file with an unseen id. */
  const join = <T extends { id: string }>(mine: T[], theirs: T[]): T[] => {
    const seen = new Set(mine.map((x) => x.id));
    return [...mine, ...theirs.filter((x) => !seen.has(x.id))];
  };

  // Attendance is a map of maps, so it merges twice: session by session, and
  // then student by student inside a session both copies happen to hold.
  const attendance: Record<string, AttendanceRecord> = { ...backup.data.attendance };
  for (const [key, record] of Object.entries(state.attendance)) {
    attendance[key] = { ...attendance[key], ...record };
  }

  // Only where this device has no picture. A face already here belongs to the
  // student as this teacher knows them.
  for (const [studentId, base64] of Object.entries(backup.photos)) {
    if (state.students.some((s) => s.id === studentId)) continue;
    try {
      writePhotoBase64(studentId, base64);
    } catch {
      // One unreadable picture must not stop the merge.
    }
  }

  useStore.setState({
    groups: join(state.groups, backup.data.groups),
    students: join(state.students, backup.data.students),
    attendance,
    messages: join(state.messages, backup.data.messages),
    replies: join(state.replies, backup.data.replies),
    events: join(state.events, backup.data.events),
    assessments: join(state.assessments, backup.data.assessments),
    assessmentTypes: join(state.assessmentTypes, backup.data.assessmentTypes),
    grades: join(state.grades, backup.data.grades),
    templates: join(state.templates, backup.data.templates),
    // The teacher's own wording stays theirs. Taking the file's would rewrite
    // what every parent reads, which is not what "add these students" asked for.
    gradeTemplate: state.gradeTemplate ?? backup.data.gradeTemplate,
    gradeTemplateFail: state.gradeTemplateFail ?? backup.data.gradeTemplateFail ?? null,
    // Same rule one level down: an override this device already has wins, and
    // the file's fills in only where there is none.
    templateOverrides: { ...backup.data.templateOverrides, ...state.templateOverrides },
    hiddenTemplates: [
      ...new Set([...state.hiddenTemplates, ...(backup.data.hiddenTemplates ?? [])]),
    ],
  });

  await flushAll();
}

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
    gradeTemplateFail: backup.data.gradeTemplateFail ?? null,
    templateOverrides: backup.data.templateOverrides ?? {},
    hiddenTemplates: backup.data.hiddenTemplates ?? [],
  });

  // Straight to disk rather than waiting for the debounce: the teacher may
  // well close the app the moment the "imported" dialog is dismissed.
  await flushAll();
}
