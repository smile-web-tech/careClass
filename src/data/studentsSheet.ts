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
 * ## What travels, and what deliberately does not
 *
 * Everything on a student except the photograph, which is a picture and not a
 * cell — pictures are added by hand afterwards, and a column of base64 would
 * make the file unreadable in the tool it exists to be read in.
 *
 * ## Classes are added, never taken away
 *
 * The Groups column was removed once, and for a real reason: it used to *set*
 * a student's memberships to whatever the cell said. A cell can only name the
 * classes a teacher happened to type, so re-importing this year's list took
 * students out of the courses they had finished, emptied archived groups and
 * dropped everybody's level with them.
 *
 * It is back, reading in one direction only. A name in the cell puts the
 * student in that class — joining the existing one, or creating it when there
 * is no class by that name. A name *missing* from the cell does nothing at all.
 * That single rule is what makes the column safe: there is no sequence of
 * imports that can cost a student a course they have done, because nothing here
 * can remove them from anything.
 *
 * The cost is that a class cannot be left by deleting it from a spreadsheet.
 * That is done from the group's roster screen, where the teacher can see the
 * class they are emptying.
 *
 * The id column is read but never written, for a similar reason from the other
 * direction — see `readOnly` on `Column`.
 */
import { flushAll } from '@/data/persistence';
import { useStore } from '@/data/store';
import type { Gender, Group, Student } from '@/data/types';
import { translateNow } from '@/i18n/useT';
import type { TranslationKey } from '@/i18n';
import { baseForLevel, levelOf, studentCourses } from '@/lib/courses';
import { toKey } from '@/lib/date';
import {
  GROUP_SEP,
  groupKey,
  indexGroupsByName,
  mergeGroupIds,
  splitGroups,
} from '@/lib/groupNames';
import { genderFromSurname, joinName, splitName, surnameOf } from '@/lib/names';
import { termOf } from '@/lib/term';
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
  /**
   * Read but never written.
   *
   * The `id` column is the only one. Ids are the app's business — a teacher
   * cannot invent one, and a column of them in a file they are meant to type
   * into is a column of noise they have to scroll past, or worse, edit. So
   * exports and the template leave it out.
   *
   * Reading it stays, and has to. A file exported by an older version has the
   * column, and it is the strongest match there is: an id says "this is the
   * same student" outright, where a name and a number only imply it.
   */
  readOnly?: boolean;
};

type CsvRow = {
  id: string;
  name: string;
  surname: string;
  patronymic: string;
  phone: string;
  email: string;
  birthDate: string;
  address: string;
  school: string;
  groups: string;
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
  note: string;
};

const COLUMNS: Column[] = [
  { key: 'id', headingKey: 'csv.id', aliases: ['id', 'studentid'], readOnly: true },
  { key: 'name', headingKey: 'csv.name', aliases: ['name', 'fullname', 'student', 'ady', 'имя', 'фио'] },
  {
    key: 'surname',
    headingKey: 'students.surname',
    aliases: ['surname', 'lastname', 'familyname', 'familiya', 'familiýasy', 'фамилия'],
  },
  /*
    The father's name, sitting where it is spoken: after the surname and before
    anything else.

    Its aliases deliberately exclude `fathername`, which belongs to the father
    *as a contact* three columns further along. The two are different facts —
    one is part of the child's name, the other is a man with a phone number —
    and a file whose heading matched both would put a patronymic in the parent
    column, or the reverse, without saying so.
  */
  {
    key: 'patronymic',
    headingKey: 'students.patronymic',
    aliases: [
      'patronymic',
      'middlename',
      'fathersname',
      'atasynynady',
      'atasynyňady',
      'atasyady',
      'отчество',
    ],
  },
  { key: 'phone', headingKey: 'csv.phone', aliases: ['phone', 'mobile', 'telefon', 'телефон'] },
  { key: 'email', headingKey: 'csv.email', aliases: ['email', 'mail', 'эл почта', 'почта'] },
  {
    key: 'birthDate',
    headingKey: 'csv.birthDate',
    aliases: ['birthdate', 'birthday', 'dob', 'dateofbirth', 'dogangüni', 'дата рождения'],
  },
  { key: 'address', headingKey: 'csv.address', aliases: ['address', 'salgy', 'адрес'] },
  { key: 'school', headingKey: 'csv.school', aliases: ['school', 'mekdep', 'школа'] },
  /*
    The classes a student is in, one cell, separated by commas.

    Read as instructions to join, never as the complete list — see the note at
    the top of this file. Written out in full, archived courses included,
    because the file is then a true record of what a student has done and
    re-importing it cannot do any harm.
  */
  {
    key: 'groups',
    headingKey: 'csv.groups',
    aliases: [
      'group',
      'groups',
      'class',
      'classes',
      'topar',
      'toparlar',
      'группа',
      'группы',
      'класс',
      'классы',
    ],
  },
  {
    key: 'level',
    headingKey: 'students.level',
    aliases: ['level', 'dereje', 'derejesi', 'уровень'],
  },
  /*
    "Document" said nothing. A teacher opening the template met a column headed
    with a word that could mean any piece of paper a child has, and the answer
    it wants is specific: the passport number for anyone who has one, the birth
    certificate number for the younger ones who do not.

    The old headings stay in the aliases, all three languages of them. A file
    this app exported last month is headed "Resminama" or "Документ", and it has
    to keep importing.
  */
  {
    key: 'documentId',
    headingKey: 'csv.documentId',
    aliases: [
      'document',
      'documentid',
      'resminama',
      'документ',
      'passport',
      'pasport',
      'паспорт',
      'birthcertificate',
      'şahadatnama',
      'sahadatnama',
      'свидетельство',
      'passportbirthcertificateid',
      'pasportşahadatnamabelgisi',
      'паспортсвидетельствоорождении',
    ],
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
  { key: 'note', headingKey: 'csv.note', aliases: ['note', 'notes', 'bellik', 'заметка'] },
];

/**
 * Comparison form for a heading: no case, no spaces, no punctuation.
 *
 * Apostrophes go too, and both shapes of them. A heading of "Father's name"
 * arrives typed straight in one file and curled by Word's autocorrect in the
 * next, and they are the same column. So does the slash, which only ever turns
 * up separating two names for one thing — "Passport / birth certificate ID".
 */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_\-.'’\/]/g, '')
    .trim();


/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** The columns this app writes, which is every column a teacher can fill in. */
const WRITTEN = COLUMNS.filter((c) => !c.readOnly);

/** The heading row, in whichever language the teacher is reading the app in. */
const headingRow = () => WRITTEN.map((c) => translateNow(c.headingKey));

/** One student flattened to the cell order the headings promise. */
function rowFor(student: Student, groups: Group[]): string[] {
  const row: CsvRow = {
    // Present in the shape, absent from the file: `WRITTEN` drops it on the way
    // out. Keeping it here means the row type stays one thing for reading and
    // writing both.
    id: student.id,
    // The full name stays whole in its own column, so a file opened in Excel
    // still reads as a register. The surname is repeated beside it because
    // that is the column a teacher fills in for a new child.
    name: student.name,
    surname: surnameOf(student),
    patronymic: student.patronymic ?? '',
    phone: student.phone,
    email: student.email ?? '',
    birthDate: student.birthDate ?? '',
    address: student.address ?? '',
    school: student.school ?? '',
    /*
      Every class, the archived ones included.

      A file listing only this term's courses would look, to the teacher reading
      it, like the app had forgotten last term's. And it costs nothing to write
      them: reading is additive, so a row naming a course the student is already
      in is a row that changes nothing.
    */
    groups: groups
      .filter((g) => student.groupIds.includes(g.id))
      .map((g) => g.name)
      .join(GROUP_SEP),
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
    note: student.note ?? '',
  };
  return WRITTEN.map((c) => row[c.key]);
}

/** The whole roster as an Excel workbook. */
export function studentsToXlsx(students: Student[], groups: Group[]): Uint8Array {
  return writeXlsx([headingRow(), ...students.map((s) => rowFor(s, groups))]);
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
    // Never reaches the file — see `readOnly` on the column. Present only
    // because the row shape is shared with reading.
    id: '',
    name: 'Aýgül Berdiýewa',
    // Filled in here, though a teacher may leave it and put the whole name in
    // the column to the left. It is what the app reads the gender from.
    surname: 'Berdiýewa',
    // The father's name, not the father. He is further along, with his number.
    patronymic: 'Serdar',
    phone: '+993 65 123456',
    email: 'aygul@example.com',
    birthDate: '2011-03-15',
    // Two classes, comma separated. A name that matches a class the teacher
    // already has puts the student in it; a name that matches nothing makes it.
    groups: `Matematika A2${GROUP_SEP}Iňlis dili B1`,
    // The level as the teacher reads it. Blank means "count it from the
    // courses in this app", which is right for anyone who started here.
    level: '2',
    address: 'Görogly köçesi 12',
    school: '№ 20',
    documentId: 'I-AŞ 123456',
    parentName: 'Maýa Berdiýewa',
    parentPhone: '+993 65 654321',
    parentEmail: 'maya@example.com',
    parentWork: 'Lukman',
    parent2Name: 'Serdar Berdiýew',
    parent2Phone: '+993 65 111222',
    parent2Email: '',
    parent2Work: 'Mugallym',
    note: '',
  };

  // The second row is the part a teacher cannot otherwise guess: a name and a
  // number are enough, and the surname column may be left to the name column.
  const minimal: CsvRow = { ...blankRow(), name: 'Batyr Amanow', phone: '+993 65 777888' };

  return writeXlsx([
    headingRow(),
    WRITTEN.map((c) => example[c.key]),
    WRITTEN.map((c) => minimal[c.key]),
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
  /**
   * The classes named in the row, as written.
   *
   * Names rather than ids, because the file cannot know an id and a teacher
   * types what they call the class. Resolved against the groups this account
   * holds at the moment the import runs — see `applyStudentSheet`.
   *
   * Empty means the row said nothing about classes, which is not the same as
   * saying the student is in none: nothing is what happens to their
   * memberships.
   */
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
    /*
      Two columns, and either one on its own is enough.

      A file this app wrote has both. A file a school wrote has one column with
      the whole name in it, and a teacher filling in the template may put the
      surname in its own column and leave the name column for the given name —
      which is what the headings invite. All three have to land as the same
      student:

        Name "Aýgül Berdiýewa", Surname ""            -> split it
        Name "Aýgül",           Surname "Berdiýewa"   -> join it
        Name "Aýgül Berdiýewa", Surname "Berdiýewa"   -> already whole

      The last case is the one that needs care: joining blindly would produce
      "Aýgül Berdiýewa Berdiýewa".
    */
    const nameCell = value(row, 'name');
    const surnameCell = value(row, 'surname');
    if (!nameCell && !surnameCell) continue; // A row with neither is a spacer.

    const alreadyWhole =
      !!surnameCell && nameCell.toLowerCase().endsWith(surnameCell.toLowerCase());
    const name = alreadyWhole || !surnameCell ? nameCell : joinName(nameCell, surnameCell);
    const surname = surnameCell || splitName(nameCell).surname;

    out.push({
      sourceId: maybe(value(row, 'id')),
      groupNames: splitGroups(value(row, 'groups')),
      level: levelFrom(value(row, 'level')),
      student: {
        name,
        surname: maybe(surname),
        patronymic: maybe(value(row, 'patronymic')),
        phone: phone(value(row, 'phone')),
        email: maybe(value(row, 'email')),
        birthDate: normaliseDate(value(row, 'birthDate')),
        address: maybe(value(row, 'address')),
        school: maybe(value(row, 'school')),
        // Read from the surname rather than asked for. A Turkmen surname says
        // which, in both scripts, and a column for it was a column of sixty
        // cells holding a fact already present two columns to the left.
        gender: genderFromSurname(surname),
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
  /**
   * Students a replace left out of the file but did not delete, because they
   * have a finished course behind them.
   */
  keptForHistory: number;
  /** Classes the file named that this account did not have, so they were made. */
  groupsCreated: number;
  /** Memberships added. Counted per student per class, and never removed. */
  joined: number;
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
  const { addStudent, updateStudent, removeStudent } = state;

  const outcome: ImportOutcome = {
    added: 0,
    updated: 0,
    removed: 0,
    keptForHistory: 0,
    groupsCreated: 0,
    joined: 0,
  };

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
    const inFile = new Set(matches.values());
    /*
      A student with a finished course behind them is not deleted by a file that
      leaves them out.

      Replace means "this file is my roster", and for a student who simply left,
      removing them is right. But a student who completed a course last term is
      the only thing holding that course's register and marks together — delete
      them and the archived group is a course that nobody attended. A teacher
      importing this year's class list is not saying last year did not happen,
      and they would have no way of knowing that is what it did.

      They are counted separately and reported, so a replace that keeps somebody
      says so rather than quietly disagreeing with the number of rows in the
      file.
    */
    const all = state.groups;
    for (const s of state.students) {
      if (inFile.has(s.id)) continue;
      if (studentCourses(s, all).finished.length) {
        outcome.keptForHistory += 1;
        continue;
      }
      removeStudent(s.id);
      outcome.removed += 1;
    }
  }

  /*
    Class names to class ids, making the ones that are not here yet.

    Built once and mutated as it goes, so twenty rows naming the same new class
    create one class and all twenty join it — resolving each row against the
    store on its own would create twenty classes with the same name.

    `indexGroupsByName` decides which class an ambiguous name means.
  */
  const groupIds = indexGroupsByName(state.groups);

  const resolveGroups = (names: string[]): string[] =>
    names.map((name) => {
      const key = groupKey(name);
      const found = groupIds.get(key);
      if (found) return found;

      /*
        A class with a name and nothing else.

        No days, no room, no subject: the file did not say, and inventing a
        Monday four o'clock would put sessions in the teacher's calendar that
        nobody agreed to. A group with no slots simply shows no sessions until
        they are set, which is a visible, fixable state — and it is already how
        the group form behaves for a course whose times are not settled.

        The term is this one, which is what a teacher importing a class list in
        September means. Without it `termOfGroup` would fall back to the current
        term anyway, so this only makes the answer stable as the year turns.
      */
      const id = state.addGroup({
        name: name.trim(),
        subject: '',
        room: '',
        slots: [],
        term: termOf(toKey(new Date())),
      });
      groupIds.set(key, id);
      outcome.groupsCreated += 1;
      return id;
    });

  for (const [i, row] of parsed.entries()) {
    const existingId = matches.get(i);
    const named = resolveGroups(row.groupNames);

    if (existingId) {
      /*
        Memberships are unioned, never replaced.

        This is the whole reason the Groups column is safe to have back. A
        student keeps every class they were already in — finished courses,
        archived ones, classes the teacher added by hand and never wrote down —
        and gains the ones this row names. Nothing a spreadsheet can say takes a
        course away from anybody.

        `accent` is left out of the patch: the parser hands colours out round
        robin, so including it reshuffled the whole roster's colours on every
        import, and the colour on an existing student is one the teacher has
        been recognising them by. `photoPath` is absent from a parsed row rather
        than empty, so it is not in the patch and is not cleared either.
      */
      const { accent: _ignored, ...fields } = row.student;
      const held = useStore.getState().students.find((s) => s.id === existingId);
      const before = held?.groupIds ?? [];
      const after = mergeGroupIds(before, named);
      const joined = after.length - before.length;

      /*
        `groupIds` only where it actually changed.

        Sending it otherwise is not merely wasteful: a mirrored `updateStudent`
        deletes and rewrites that student's whole `student_groups` row set, so
        an import of a file with no Groups column at all would rewrite sixty
        rosters on the server to arrive at exactly what was already there.
      */
      updateStudent(existingId, {
        ...fields,
        ...(joined ? { groupIds: after } : {}),
        ...levelPatch(row, after),
      });
      outcome.joined += joined;
      outcome.updated += 1;
    } else {
      addStudent({ ...row.student, groupIds: named, ...levelPatch(row, named) });
      outcome.joined += named.length;
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
