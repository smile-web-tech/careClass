/**
 * The database on the phone.
 *
 * ClassCare is used where the internet is a sometimes thing, so the device is
 * the primary store and the server is a copy of it rather than the other way
 * round. Everything a teacher enters lands here first, in `classcare.db` inside
 * the app's own `ClassCare` folder (see `lib/appFolder.ts`), and reaches
 * Supabase whenever there is a route to it.
 *
 * ## Why tables rather than one blob
 *
 * The store used to be persisted as a single JSON string through
 * `AsyncStorage`. That works until it does not: the whole state is rewritten on
 * every keystroke-sized change, a half-written value takes everything with it,
 * and there is no way to read one group without parsing a term of attendance.
 * Real tables make each write small, atomic, and inspectable — and give the
 * export something honest to serialise.
 *
 * ## How it relates to the zustand store
 *
 * The store stays the thing screens read from: synchronous, in memory, already
 * wired into every component. This module is its persistence, loaded once at
 * launch and written through on every change. Nothing in the UI awaits SQLite.
 *
 * ## Shape
 *
 * Each collection is a table of `(id, json)` plus the couple of columns worth
 * indexing. The JSON column is deliberate: the domain types in `data/types.ts`
 * are the schema, they change with the app, and mirroring every field into
 * columns would mean a migration for each one while buying nothing — nothing
 * queries this by field. What the columns buy is the ability to write, replace
 * and delete one row at a time.
 */
import { Directory, File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { appDirectory, moveIfPresent } from '@/lib/appFolder';
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

/** Bumped only when the table layout changes in a way `migrate` must handle. */
const SCHEMA_VERSION = 1;

export const DATABASE_NAME = 'classcare.db';

/**
 * Every collection the store persists, and how a row is keyed.
 *
 * Attendance is keyed by its composite `groupId@date#start` rather than a uuid,
 * which is the same key the store uses in memory — see `attendanceKey`.
 */
export type Collection =
  | 'groups'
  | 'students'
  | 'attendance'
  | 'messages'
  | 'replies'
  | 'events'
  | 'assessments'
  | 'assessment_types'
  | 'grades'
  | 'templates';

const COLLECTIONS: Collection[] = [
  'groups',
  'students',
  'attendance',
  'messages',
  'replies',
  'events',
  'assessments',
  'assessment_types',
  'grades',
  'templates',
];

/** Everything the local database holds, in the shapes the store uses. */
export type LocalSnapshot = {
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
  /** Single-row settings: the teacher, their language, their wording. */
  settings: Record<string, unknown>;
};

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * The folder the database lives in, having moved anything left behind.
 *
 * It used to sit wherever `expo-sqlite` puts things, which is a folder with no
 * name a teacher would recognise and no relationship to where the photos were.
 * Everything the app owns is under `ClassCare/` now.
 *
 * The move happens here rather than at startup because it has to happen before
 * the file is opened — SQLite holds the handle afterwards, and moving a file
 * out from under an open connection is how a database gets corrupted. All three
 * files go together: the `-wal` holds committed transactions that are not in
 * the main file yet, so moving the `.db` alone would silently roll back the
 * last session's work.
 *
 * A failure here is not fatal. `moveIfPresent` swallows it and the old file is
 * left alone, so the worst case is the previous layout continuing to work.
 */
function databaseDirectory(): string {
  const target = appDirectory();

  try {
    const legacy = SQLite.defaultDatabaseDirectory as string | undefined;
    if (legacy) {
      const from = new Directory(legacy);
      for (const suffix of ['', '-wal', '-shm']) {
        moveIfPresent(
          new File(from, `${DATABASE_NAME}${suffix}`),
          new File(target, `${DATABASE_NAME}${suffix}`),
        );
      }
    }
  } catch {
    // No legacy directory, or it cannot be read. Nothing to bring across.
  }

  return target.uri;
}

/**
 * Open once, and only once.
 *
 * Two calls landing together during startup would otherwise each open a
 * connection and each run the schema, which SQLite tolerates and which makes
 * the "did the migration run" question unanswerable.
 */
export function openLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (database) return Promise.resolve(database);
  if (opening) return opening;

  opening = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME, undefined, databaseDirectory());

    // WAL is the difference between a write blocking a read and not. The store
    // writes on every change while screens are reading; without this they
    // queue behind each other and a busy save shows up as a stutter.
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA foreign_keys = ON;');

    await migrate(db);
    database = db;
    return db;
  })();

  return opening;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  const tables = COLLECTIONS.map(
    (name) => `
      create table if not exists ${name} (
        id   text primary key not null,
        json text not null
      );`,
  ).join('\n');

  await db.execAsync(`
    ${tables}

    /* One row per key. Holds the teacher's profile, their language, the grade
       template — everything that is a setting rather than a collection. */
    create table if not exists settings (
      key   text primary key not null,
      value text not null
    );

    /*
      Unsent writes, in order.

      The outbox lived in AsyncStorage as its own JSON file, which meant two
      stores that had to agree about the same account and could disagree after
      a crash between the two writes. Here it commits in the same database as
      the data it describes.
    */
    create table if not exists outbox (
      seq        integer primary key autoincrement,
      op         text not null,
      created_at integer not null
    );

    create table if not exists meta (
      key   text primary key not null,
      value text not null
    );
  `);

  const row = await db.getFirstAsync<{ value: string }>(
    "select value from meta where key = 'schema_version'",
  );
  const current = Number(row?.value ?? 0);

  if (current < SCHEMA_VERSION) {
    // Nothing to do for version 1 beyond the create-table statements above.
    // Later versions add their `alter table`s here, guarded by `current`.
    await db.runAsync(
      "insert or replace into meta (key, value) values ('schema_version', ?)",
      String(SCHEMA_VERSION),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

async function readCollection<T>(db: SQLite.SQLiteDatabase, name: Collection): Promise<T[]> {
  const rows = await db.getAllAsync<{ id: string; json: string }>(`select json from ${name}`);
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.json) as T);
    } catch {
      // One unreadable row must not cost the teacher the other three hundred.
      // Skipping it is also self-healing: the next write replaces the table.
    }
  }
  return out;
}

/** Everything, for the store to start from. */
export async function loadSnapshot(): Promise<LocalSnapshot> {
  const db = await openLocalDb();

  const [
    groups,
    students,
    attendanceRows,
    messages,
    replies,
    events,
    assessments,
    assessmentTypes,
    grades,
    templates,
  ] = await Promise.all([
    readCollection<Group>(db, 'groups'),
    readCollection<Student>(db, 'students'),
    db.getAllAsync<{ id: string; json: string }>('select id, json from attendance'),
    readCollection<Message>(db, 'messages'),
    readCollection<Reply>(db, 'replies'),
    readCollection<CalendarEvent>(db, 'events'),
    readCollection<Assessment>(db, 'assessments'),
    readCollection<AssessmentType>(db, 'assessment_types'),
    readCollection<Grade>(db, 'grades'),
    readCollection<MessageTemplate>(db, 'templates'),
  ]);

  const attendance: Record<string, AttendanceRecord> = {};
  for (const row of attendanceRows) {
    try {
      attendance[row.id] = JSON.parse(row.json) as AttendanceRecord;
    } catch {
      // As above: drop the one, keep the rest.
    }
  }

  const settingRows = await db.getAllAsync<{ key: string; value: string }>(
    'select key, value from settings',
  );
  const settings: Record<string, unknown> = {};
  for (const row of settingRows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }

  return {
    groups,
    students,
    attendance,
    messages,
    replies,
    events,
    assessments,
    assessmentTypes,
    grades,
    templates,
    settings,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Replace a whole collection.
 *
 * Delete-then-insert inside one transaction, rather than working out which
 * rows changed. At the scale of one tutor — tens of groups, hundreds of
 * students — the diff costs more to compute than the write costs to perform,
 * and it cannot go wrong the way a missed deletion can.
 */
export async function replaceCollection(name: Collection, rows: { id: string; value: unknown }[]) {
  const db = await openLocalDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`delete from ${name}`);
    for (const row of rows) {
      await db.runAsync(`insert into ${name} (id, json) values (?, ?)`, [
        row.id,
        JSON.stringify(row.value),
      ]);
    }
  });
}

export async function writeSetting(key: string, value: unknown) {
  const db = await openLocalDb();
  await db.runAsync('insert or replace into settings (key, value) values (?, ?)', [
    key,
    JSON.stringify(value),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

export async function readOutbox(): Promise<{ seq: number; op: unknown }[]> {
  const db = await openLocalDb();
  const rows = await db.getAllAsync<{ seq: number; op: string }>(
    'select seq, op from outbox order by seq',
  );
  const out: { seq: number; op: unknown }[] = [];
  for (const row of rows) {
    try {
      out.push({ seq: row.seq, op: JSON.parse(row.op) });
    } catch {
      // Unparseable op: drop it rather than wedging the queue behind it.
    }
  }
  return out;
}

export async function replaceOutbox(ops: unknown[]) {
  const db = await openLocalDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('delete from outbox');
    for (const op of ops) {
      await db.runAsync('insert into outbox (op, created_at) values (?, ?)', [
        JSON.stringify(op),
        now,
      ]);
    }
  });
}

/**
 * Empty the device of one account's data.
 *
 * Used when a different teacher signs in on the same phone. The settings table
 * goes too — it holds their name, their email and their wording.
 */
export async function clearLocalData() {
  const db = await openLocalDb();
  await db.withTransactionAsync(async () => {
    for (const name of COLLECTIONS) await db.runAsync(`delete from ${name}`);
    await db.runAsync('delete from settings');
    await db.runAsync('delete from outbox');
  });
}
