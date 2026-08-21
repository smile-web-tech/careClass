/**
 * A class list as a spreadsheet.
 *
 * A `.classcare` backup moves an account between phones; this moves *students*
 * between ClassCare and the place a teacher already keeps them. Every tutor
 * arriving at this app has a list somewhere — a school's export, a notebook
 * typed into Excel, a WhatsApp message pasted into Sheets — and asking them to
 * retype sixty children with two parents each is asking them not to bother.
 *
 * ## Two formats, one path
 *
 * ClassCare *writes* `.xlsx`, because that is what a teacher means by "my
 * students in Excel": a file that opens into a proper sheet with headings and
 * columns, not one that lands in a single column because their copy of Excel
 * was installed in a locale that separates with semicolons.
 *
 * ClassCare *reads* both. The file a teacher has to hand is as often a `.csv` —
 * exported by a school system, saved out of Google Sheets — and refusing it
 * would be refusing the very list this feature exists to accept.
 *
 * Both formats reduce to rows of strings before anything else happens, so the
 * column matching, the date handling and the import rules are written once and
 * cannot drift between the two.
 *
 * ## Reading is deliberately more forgiving than writing
 *
 * The CSV delimiter is sniffed — comma, semicolon or tab — because an Excel
 * installed in a Russian locale writes semicolons and its owner has no idea
 * that it does. Column order is not assumed either; headings are matched by
 * name, in any of the three languages, so a teacher can hand us the file their
 * school gave them.
 *
 * ## What travels
 *
 * Everything on a student except the photograph, which is a picture and not a
 * cell — they are added by hand afterwards, and a column of base64 would make
 * the file unreadable in the tool it exists to be read in.
 *
 * Groups travel as names rather than ids, because a name is the thing a teacher
 * can type. See `applyStudentSheet` for what happens to a name we do not know.
 */
import { flushAll } from '@/data/persistence';
import { useStore } from '@/data/store';
import type { Gender, Group, Student } from '@/data/types';
import { translateNow } from '@/i18n/useT';
import type { TranslationKey } from '@/i18n';
import { baseForLevel, levelOf } from '@/lib/courses';
import { accentNames } from '@/theme';
import { readXlsx, serialToDate, writeXlsx } from '@/lib/xlsx';
import { strFromU8 } from 'fflate';

/* -------------------------------------------------------------------------- */
/* Columns                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One column, and every spelling of it we will answer to.
 *
 * `aliases` are lower-cased and stripped of spaces and punctuation before
 * comparison, so "Parent phone", "parent_phone" and "PARENT PHONE" are one
 * thing. The translated headings are included so a file this app exported in
 * Turkmen can be imported by the same app in Russian — which is not exotic:
 * it is one teacher who changed the language.
 */
type Column = {
  key: keyof CsvRow;
  headingKey: TranslationKey;
  aliases: string[];
};

type CsvRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  address: string;
  school: string;
  gender: string;
  level: string;
  documentId: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  parentWork: string;
  parent2Name: string;
  parent2Phone: string;
  parent2Email: string;
  parent2Work: string;
  groups: string;
  note: string;
};

const COLUMNS: Column[] = [
  { key: 'id', headingKey: 'csv.id', aliases: ['id', 'studentid'] },
  { key: 'name', headingKey: 'csv.name', aliases: ['name', 'fullname', 'student', 'ady', 'имя', 'фио'] },
  { key: 'phone', headingKey: 'csv.phone', aliases: ['phone', 'mobile', 'telefon', 'телефон'] },
  { key: 'email', headingKey: 'csv.email', aliases: ['email', 'mail', 'эл почта', 'почта'] },
  {
    key: 'birthDate',
    headingKey: 'csv.birthDate',
    aliases: ['birthdate', 'birthday', 'dob', 'dateofbirth', 'dogangüni', 'дата рождения'],
  },
  { key: 'address', headingKey: 'csv.address', aliases: ['address', 'salgy', 'адрес'] },
  { key: 'school', headingKey: 'csv.school', aliases: ['school', 'mekdep', 'школа'] },
  {
    key: 'gender',
    headingKey: 'csv.gender',
    aliases: ['gender', 'sex', 'jyns', 'пол'],
  },
  {
    key: 'level',
    headingKey: 'students.level',
    aliases: ['level', 'dereje', 'derejesi', 'уровень'],
  },
  {
    key: 'documentId',
    headingKey: 'csv.documentId',
    aliases: ['document', 'documentid', 'passport', 'pasport', 'документ', 'паспорт'],
  },
  {
    key: 'parentName',
    headingKey: 'csv.motherName',
    aliases: ['mother', 'mothername', 'parent', 'parentname', 'parent1', 'eje', 'мама', 'мать'],
  },
  {
    key: 'parentPhone',
    headingKey: 'csv.motherPhone',
    aliases: ['motherphone', 'parentphone', 'parent1phone', 'телефон мамы'],
  },
  {
    key: 'parentEmail',
    headingKey: 'csv.motherEmail',
    aliases: ['motheremail', 'parentemail', 'parent1email'],
  },
  {
    key: 'parentWork',
    headingKey: 'csv.motherWork',
    aliases: ['motherwork', 'parentwork', 'parent1work', 'работа мамы'],
  },
  {
    key: 'parent2Name',
    headingKey: 'csv.fatherName',
    aliases: ['father', 'fathername', 'parent2', 'parent2name', 'kaka', 'папа', 'отец'],
  },
  {
    key: 'parent2Phone',
    headingKey: 'csv.fatherPhone',
    aliases: ['fatherphone', 'parent2phone', 'телефон папы'],
  },
  { key: 'parent2Email', headingKey: 'csv.fatherEmail', aliases: ['fatheremail', 'parent2email'] },
  {
    key: 'parent2Work',
    headingKey: 'csv.fatherWork',
    aliases: ['fatherwork', 'parent2work', 'работа папы'],
  },
  {
    key: 'groups',
    headingKey: 'csv.groups',
    aliases: ['group', 'groups', 'class', 'classes', 'topar', 'группа', 'группы'],
  },
  { key: 'note', headingKey: 'csv.note', aliases: ['note', 'notes', 'bellik', 'заметка'] },
];

/** Comparison form for a heading: no case, no spaces, no punctuation. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_\-.]/g, '')
    .trim();

/** More than one group in one cell, since a student can be in several. */
const GROUP_SEPARATOR = ' | ';

/** What we write into the gender cell, in the language being read. */
const GENDER_KEY = {
  male: 'students.male',
  female: 'students.female',
} as const satisfies Record<Gender, TranslationKey>;

/**
 * Every spelling of "boy" and "girl" we will accept in a cell.
 *
 * Headings are matched in three languages, so the values have to be too — a
 * teacher whose school exported `Пол: мужской` is not going to find and replace
 * sixty cells before importing. Single letters are in because a hand-kept list
 * is as likely to say `m` or `ж` as anything longer.
 *
 * Anything unrecognised leaves the field absent rather than guessing. A wrongly
 * assigned gender is worse than a blank one: it is silently wrong, it appears
 * on filtered lists the teacher trusts, and nothing on screen suggests it was
 * inferred.
 */
const GENDER_WORDS: Record<Gender, string[]> = {
  male: ['m', 'male', 'boy', 'man', 'erkek', 'oglan', 'м', 'муж', 'мужской', 'мальчик', 'мужчина'],
  female: ['f', 'w', 'female', 'girl', 'woman', 'ayal', 'aýal', 'gyz', 'ж', 'жен', 'женский', 'девочка', 'женщина'],
};

function parseGender(raw: string): Gender | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  for (const [gender, words] of Object.entries(GENDER_WORDS) as [Gender, string[]][]) {
    if (words.includes(v)) return gender;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** The heading row, in whichever language the teacher is reading the app in. */
const headingRow = () => COLUMNS.map((c) => translateNow(c.headingKey));

/** One student flattened to the cell order the headings promise. */
function rowFor(student: Student, nameOf: Map<string, string>, groups: Group[]): string[] {
  const row: CsvRow = {
    id: student.id,
    name: student.name,
    phone: student.phone,
    email: student.email ?? '',
    birthDate: student.birthDate ?? '',
    address: student.address ?? '',
    school: student.school ?? '',
    gender: student.gender ? translateNow(GENDER_KEY[student.gender]) : '',
    // The level as a teacher reads it, not the base stored behind it. A column
    // of bases would be a column of numbers that do not match the app.
    level: String(levelOf(student, groups)),
    documentId: student.documentId ?? '',
    parentName: student.parentName ?? '',
    parentPhone: student.parentPhone ?? '',
    parentEmail: student.parentEmail ?? '',
    parentWork: student.parentWork ?? '',
    parent2Name: student.parent2Name ?? '',
    parent2Phone: student.parent2Phone ?? '',
    parent2Email: student.parent2Email ?? '',
    parent2Work: student.parent2Work ?? '',
    groups: student.groupIds
      .map((id) => nameOf.get(id))
      .filter((n): n is string => !!n)
      .join(GROUP_SEPARATOR),
    note: student.note ?? '',
  };
  return COLUMNS.map((c) => row[c.key]);
}

/** The whole roster as an Excel workbook. */
export function studentsToXlsx(students: Student[], groups: Group[]): Uint8Array {
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));
  return writeXlsx([headingRow(), ...students.map((s) => rowFor(s, nameOf, groups))]);
}

/**
 * A workbook with the right headings and two rows showing what goes in them.
 *
 * Offered whenever an import fails, because "could not read that file" on its
 * own leaves the teacher guessing at column names — and they will guess wrong,
 * try again, and give up. A sample they can open in Excel and type over turns a
 * dead end into a two-minute job.
 *
 * Two example rows, not one. The first is filled in completely, so every column
 * has something in it to copy the shape of; the second has only a name and a
 * number, which is the part a teacher cannot otherwise know — that everything
 * else is optional.
 */
export function sampleStudentsXlsx(): Uint8Array {
  const example: CsvRow = {
    // Left empty on purpose: an id is how the app recognises a student it
    // already has, and a new one should not claim to be anybody.
    id: '',
    name: 'Aýgül Berdiýewa',
    phone: '+993 65 123456',
    email: 'aygul@example.com',
    birthDate: '2011-03-15',
    // The level as the teacher reads it. Blank means "count it from the
    // courses in this app", which is right for anyone who started here.
    level: '2',
    address: 'Görogly köçesi 12',
    school: '№ 20',
    // Written the way the export writes it, so the template teaches the
    // vocabulary the importer already answers to.
    gender: translateNow('students.female'),
    documentId: 'I-AŞ 123456',
    parentName: 'Maýa Berdiýewa',
    parentPhone: '+993 65 654321',
    parentEmail: 'maya@example.com',
    parentWork: 'Lukman',
    parent2Name: 'Serdar Berdiýew',
    parent2Phone: '+993 65 111222',
    parent2Email: '',
    parent2Work: 'Mugallym',
    groups: `IELTS${GROUP_SEPARATOR}Algebra`,
    note: '',
  };

  const minimal: CsvRow = { ...blankRow(), name: 'Batyr Amanow', phone: '+993 65 777888' };

  return writeXlsx([
    headingRow(),
    COLUMNS.map((c) => example[c.key]),
    COLUMNS.map((c) => minimal[c.key]),
  ]);
}

const blankRow = (): CsvRow =>
  Object.fromEntries(COLUMNS.map((c) => [c.key, ''])) as unknown as CsvRow;

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export class SheetError extends Error {
  constructor(readonly reason: 'empty' | 'noName' | 'unreadable') {
    super(reason);
  }
}

/**
 * Split a CSV document into rows of cells.
 *
 * Written out rather than pulled in, because the interesting half of a CSV
 * parser is the quoting rules and a dependency would be most of a megabyte to
 * get them. Handles quoted fields, doubled quotes inside them, and newlines
 * inside quotes — which is how a multi-line address arrives.
 */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // The BOM is ours or Excel's; either way it is not part of the first heading.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        // A doubled quote is a literal one; a single quote ends the field.
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  // Whatever is left when the text runs out is a final field, unless the file
  // ended tidily with a newline and there is nothing in hand.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length));
}

/**
 * Which character separates the columns.
 *
 * Counted outside quotes on the header line only. An Excel installed in a
 * Russian or Turkish locale writes semicolons and its owner does not know that
 * it does, so refusing their file would be refusing it for a reason they cannot
 * act on.
 */
function sniffDelimiter(text: string): string {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  let quoted = false;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };

  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * A file the teacher chose, as rows, whichever of the two formats it is.
 *
 * Sniffed from the bytes rather than trusted to the extension: Android file
 * managers hand a `.xlsx` over as `application/octet-stream` often enough, and
 * a teacher who renamed a file is not wrong about what is in it. `PK` is the
 * zip signature every Office document starts with.
 */
export function rowsFromFile(bytes: Uint8Array): string[][] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (isZip) {
    try {
      return readXlsx(bytes);
    } catch {
      // A zip that is not a workbook — a `.zip` of something else, or a file
      // that did not finish downloading.
      throw new SheetError('unreadable');
    }
  }

  /*
    `strFromU8` rather than `TextDecoder`.

    Hermes does not ship `TextDecoder`, and React Native does not polyfill it,
    so the obvious line would work in the simulator and throw on a phone. This
    comes from the zip library that is already here and decodes UTF-8 properly,
    which matters for every name in the file.
  */
  const text = strFromU8(bytes);
  return parseRows(text, sniffDelimiter(text));
}

export type ParsedStudent = {
  /** The id from the file, when it carried one. Never trusted blindly. */
  sourceId?: string;
  student: Omit<Student, 'id' | 'groupIds'>;
  /** Group names exactly as written in the cell. */
  groupNames: string[];
  /**
   * The level as the file states it, before it is turned into a stored base.
   *
   * Converted only once the student's groups are known — the base is the level
   * minus the courses of theirs that have finished, and until the group names
   * in the row have been resolved to ids there is nothing to count.
   */
  level?: number;
};

/**
 * A level cell, or nothing.
 *
 * Blank means "count it", not zero, so the column can be left out entirely by
 * the many teachers who will never think about it. Anything that is not a
 * plain non-negative number is ignored rather than guessed at: a file saying
 * "beginner" in this column should leave the counting alone, not reset it.
 */
function levelFrom(raw: string): number | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Read a spreadsheet into students, without touching the store. */
export function studentsFromRows(rows: string[][]): ParsedStudent[] {
  if (rows.length < 2) throw new SheetError('empty');

  /*
    Headings decide the columns, not their order.

    A file from a school will not have our column order and asking a teacher to
    rearrange twenty columns in Excel before importing is asking them to give
    up. Anything we do not recognise is ignored rather than refused: a school's
    export carries a dozen fields this app has nowhere to put.
  */
  const headings = rows[0].map(normalise);
  const index: Partial<Record<keyof CsvRow, number>> = {};

  for (const column of COLUMNS) {
    const wanted = new Set([
      normalise(translateNow(column.headingKey)),
      ...column.aliases.map(normalise),
    ]);
    const at = headings.findIndex((h) => wanted.has(h));
    if (at >= 0) index[column.key] = at;
  }

  if (index.name === undefined) throw new SheetError('noName');

  const value = (row: string[], key: keyof CsvRow) => {
    const at = index[key];
    return at === undefined ? '' : (row[at] ?? '').trim();
  };

  /**
   * A phone number, with the `+` a spreadsheet ate put back.
   *
   * Excel reads a leading `+` as the start of a formula: type `+99365000000`
   * and it evaluates it, stores the number 99365000000, and the plus is gone
   * from the file before it is ever saved. Our own template now formats those
   * columns as text so it cannot happen again — but the file a teacher already
   * has was written before that, or by a school system, or by Excel on someone
   * else's laptop.
   *
   * Ten digits is the line. Numbers here are eight digits locally and eleven or
   * twelve with the country code, so a bare run of ten or more digits is an
   * international number missing its plus, and a shorter one is a local number
   * that never had one. Anything already carrying a `+`, a space or a bracket
   * is left exactly as the teacher wrote it.
   */
  const phone = (raw: string) => {
    const v = raw.trim();
    return /^\d{10,}$/.test(v) ? `+${v}` : v;
  };

  /** Empty strings become absent, so a blank cell does not overwrite with "". */
  const maybe = (v: string) => (v.length ? v : undefined);

  const out: ParsedStudent[] = [];

  for (const row of rows.slice(1)) {
    const name = value(row, 'name');
    if (!name) continue; // A row with no name is a spacer, not a person.

    out.push({
      sourceId: maybe(value(row, 'id')),
      level: levelFrom(value(row, 'level')),
      groupNames: value(row, 'groups')
        .split(/[|;,]/)
        .map((g) => g.trim())
        .filter(Boolean),
      student: {
        name,
        phone: phone(value(row, 'phone')),
        email: maybe(value(row, 'email')),
        birthDate: normaliseDate(value(row, 'birthDate')),
        address: maybe(value(row, 'address')),
        school: maybe(value(row, 'school')),
        gender: parseGender(value(row, 'gender')),
        documentId: maybe(value(row, 'documentId')),
        parentName: maybe(value(row, 'parentName')),
        parentPhone: maybe(phone(value(row, 'parentPhone'))),
        parentEmail: maybe(value(row, 'parentEmail')),
        parentWork: maybe(value(row, 'parentWork')),
        parent2Name: maybe(value(row, 'parent2Name')),
        parent2Phone: maybe(phone(value(row, 'parent2Phone'))),
        parent2Email: maybe(value(row, 'parent2Email')),
        parent2Work: maybe(value(row, 'parent2Work')),
        note: maybe(value(row, 'note')),
        accent: accentNames[out.length % accentNames.length],
      },
    });
  }

  return out;
}

/**
 * A birth date the app can use, from whatever the spreadsheet had in the cell.
 *
 * Excel hands back `15/03/2011`, `2011-03-15` or `15.03.2011` depending on the
 * machine it was typed on, and the birthday reminder needs one shape. Anything
 * unrecognisable is dropped rather than guessed: a wrong birthday sends a
 * cheerful notification on a stranger's date, which is worse than none.
 *
 * Day-first is assumed for the ambiguous `03/04/2011`, because that is how
 * dates are written across the region this app is for.
 */
function normaliseDate(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;

  /*
    A bare number is Excel's own way of writing a date.

    A teacher who formats the birthday column as a date — which Excel does by
    itself the moment something looks like one — stores `40617`, not a string.
    Without this the column fills with five-digit numbers and every birthday
    reminder is wrong. Bounded inside `serialToDate`, so a phone number typed
    into the wrong column is left alone rather than becoming a date in the year
    180000.
  */
  if (/^\d+(\.\d+)?$/.test(value)) return serialToDate(value) ?? undefined;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return pad(+iso[1], +iso[2], +iso[3]);

  const dmy = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) return pad(+dmy[3], +dmy[2], +dmy[1]);

  return undefined;
}

function pad(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Applying                                                                   */
/* -------------------------------------------------------------------------- */

export type ImportOutcome = {
  added: number;
  updated: number;
  removed: number;
  /** Groups named in the file that did not exist and were created. */
  groupsCreated: string[];
};

/**
 * Put parsed students into the store.
 *
 * `mode` is the teacher's answer to what happens to the people already here.
 * `merge` updates the ones the file recognises and adds the rest; `replace`
 * removes everybody first, which is the honest reading of "delete and import
 * new" and is confirmed in the danger colour before it is reached.
 *
 * An id is kept only when this account already holds it. A file from another
 * teacher's ClassCare carries their ids, and those belong to their account on
 * the server — writing them here is refused row by row, which is the whole
 * lesson of `reownBackup` learned once already.
 *
 * A group named in the file that does not exist is created, with no schedule.
 * The alternative is dropping the column, which leaves sixty students in no
 * group at all and the teacher wondering what the import did. A group with no
 * days simply shows no sessions until they set them, which is a visible,
 * fixable state rather than a silent loss.
 */
/**
 * The level column, turned into the base that is actually stored.
 *
 * Done here rather than in the parser because the base is the level minus the
 * courses of theirs that have already finished, and the row's group names only
 * became group ids a few lines ago. A row with no level in it contributes
 * nothing at all — an absent key, not a zero, so importing a file without the
 * column leaves everybody's level exactly as it was.
 */
function levelPatch(row: ParsedStudent, groupIds: string[]) {
  if (row.level === undefined) return {};
  const groups = useStore.getState().groups.filter((g) => groupIds.includes(g.id));
  return { levelBase: baseForLevel(row.level, { groupIds }, groups) };
}

/**
 * Which parsed rows are students the teacher already has.
 *
 * Returns row index to existing student id. A match is only ever claimed once:
 * two rows naming the same person cannot both take them, or the second would
 * overwrite the first and the teacher would end up with one student where the
 * file had two.
 *
 * Three tiers, in descending confidence:
 *
 * 1. The `id` column, which is what this app writes when it exports. Exact.
 * 2. Name *and* phone. Two different children can share a name; sharing a name
 *    and a number as well means it is one child.
 * 3. Name alone, but only where neither side has a phone to contradict the
 *    other. A list from a school routinely has no numbers in it, and refusing
 *    to match those would make re-importing a corrected list duplicate the
 *    entire roster — while a name matching against a *different* phone is
 *    exactly the case where two children really do share a name.
 *
 * Deliberately not fuzzy. A near-match here silently merges two people's
 * records, which is far worse than the duplicate it saves.
 */
function matchExisting(parsed: ParsedStudent[], students: Student[]) {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const digits = (s: string) => s.replace(/\D/g, '');

  const taken = new Set<string>();
  const out = new Map<number, string>();

  const byId = new Map(students.map((s) => [s.id, s]));
  const byNamePhone = new Map<string, Student[]>();
  const byName = new Map<string, Student[]>();
  for (const s of students) {
    push(byName, key(s.name), s);
    if (digits(s.phone)) push(byNamePhone, `${key(s.name)}|${digits(s.phone)}`, s);
  }

  const claim = (index: number, s: Student | undefined) => {
    if (!s || taken.has(s.id)) return false;
    taken.add(s.id);
    out.set(index, s.id);
    return true;
  };

  const free = (list: Student[] | undefined) => list?.find((s) => !taken.has(s.id));

  /*
    A pass per tier, across every row, rather than all three tiers per row.

    Per-row, a weak match claims a student a stronger one was going to want: two
    children called Batyr, one of them with no number, and a row carrying no
    phone reaches the one whose phone matches the *next* row exactly. Running
    the confident matches first means a tier can only ever take what no better
    tier wanted.
  */
  parsed.forEach((row, i) => {
    if (row.sourceId) claim(i, byId.get(row.sourceId));
  });

  parsed.forEach((row, i) => {
    if (out.has(i)) return;
    const phone = digits(row.student.phone ?? '');
    if (!phone) return;
    claim(i, free(byNamePhone.get(`${key(row.student.name)}|${phone}`)));
  });

  parsed.forEach((row, i) => {
    if (out.has(i)) return;
    const phone = digits(row.student.phone ?? '');
    const sameName = byName.get(key(row.student.name)) ?? [];
    claim(i, free(sameName.filter((s) => !phone || !digits(s.phone))));
  });

  return out;
}

const push = <T,>(map: Map<string, T[]>, k: string, value: T) => {
  const list = map.get(k);
  if (list) list.push(value);
  else map.set(k, [value]);
};

export async function applyStudentSheet(
  parsed: ParsedStudent[],
  mode: 'merge' | 'replace',
): Promise<ImportOutcome> {
  const state = useStore.getState();
  const { addStudent, updateStudent, removeStudent, addGroup } = state;

  const outcome: ImportOutcome = { added: 0, updated: 0, removed: 0, groupsCreated: [] };

  /*
    Who in the file is already here.

    Worked out *before* anything is written, and for both modes, because the
    answer decides whether a student is edited or replaced — and replacing one
    costs them their photograph. A picture is not in the spreadsheet and cannot
    come back from it: the file on the device is keyed by student id, so a
    student deleted and re-added under a fresh id has an orphaned photo and a
    blank avatar, even though the teacher's file said nothing about pictures at
    all.

    So `replace` no longer means "delete everyone, then read the file". It means
    "the file is the roster now": students in it keep their identity and
    everything the file does not carry, and only students absent from it go.
  */
  const matches = matchExisting(parsed, state.students);

  if (mode === 'replace') {
    const kept = new Set(matches.values());
    for (const s of state.students) {
      if (kept.has(s.id)) continue;
      removeStudent(s.id);
      outcome.removed += 1;
    }
  }

  /*
    Group ids by lower-cased name, so "IELTS" and "ielts" are one class.

    Archived groups are left out on purpose. A teacher importing a class list
    for a course whose name matches one they filed away last term is starting
    that course again, not reopening the finished one — matching it would put
    this year's children into last year's register.
  */
  const byName = new Map(
    useStore
      .getState()
      .groups.filter((g) => !g.archivedAt)
      .map((g) => [g.name.trim().toLowerCase(), g.id]),
  );

  const groupIdsFor = (names: string[]) => {
    const ids: string[] = [];
    for (const name of names) {
      const key = name.toLowerCase();
      let id = byName.get(key);
      if (!id) {
        // No days and no times: a group the teacher has to finish rather than
        // one the app invented a timetable for. `subject` mirrors the name
        // because the file has nothing better and a blank subject reads as a
        // bug.
        id = addGroup({ name, subject: name, room: '', slots: [] });
        byName.set(key, id);
        outcome.groupsCreated.push(name);
      }
      ids.push(id);
    }
    return [...new Set(ids)];
  };

  for (const [i, row] of parsed.entries()) {
    const groupIds = groupIdsFor(row.groupNames);
    const existingId = matches.get(i);

    if (existingId) {
      // `accent` is stripped on purpose. The parser hands out colours round
      // robin, so leaving it in would reshuffle the whole roster's colours on
      // every import — and the colour on an existing student is one the teacher
      // has been recognising them by. `photoPath` is absent from a parsed row
      // rather than empty, so it is not in this patch and is not cleared.
      const { accent: _ignored, ...fields } = row.student;
      updateStudent(existingId, { ...fields, groupIds, ...levelPatch(row, groupIds) });
      outcome.updated += 1;
    } else {
      addStudent({ ...row.student, groupIds, ...levelPatch(row, groupIds) });
      outcome.added += 1;
    }
  }

  /*
    Straight to disk, rather than waiting for the debounce.

    Every other write in the app can afford to be coalesced for a few hundred
    milliseconds. An import cannot: sixty students arrive in one go and the
    teacher's very next act is often to close the app, sign out, or hand the
    phone to somebody — and Android kills a backgrounded app freely on the
    hardware these teachers carry. The backup import has always done this; this
    one did not, which is the difference between a class list that survives the
    walk to the next room and one that does not.
  */
  await flushAll();

  return outcome;
}
