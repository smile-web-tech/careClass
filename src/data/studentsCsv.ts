/**
 * A class list as a spreadsheet.
 *
 * A `.classcare` backup moves an account between phones; this moves *students*
 * between ClassCare and the place a teacher already keeps them. Every tutor
 * arriving at this app has a list somewhere — a school's export, a notebook
 * typed into Excel, a WhatsApp message pasted into Sheets — and asking them to
 * retype sixty children with two parents each is asking them not to bother.
 *
 * ## The format
 *
 * One header row and one row per student, comma-separated, UTF-8 with a byte
 * order mark. The BOM is not decoration: without it Excel reads a Turkmen or
 * Russian name as mojibake, which is the first thing the teacher sees and the
 * last thing they trust.
 *
 * Reading is deliberately more forgiving than writing. The delimiter is sniffed
 * from the header — comma, semicolon or tab — because an Excel installed in a
 * Russian locale writes semicolons and its owner has no idea that it does, and
 * a file that opens fine on their screen must not be refused by us. Column
 * order is not assumed either; headers are matched by name, in any of the three
 * languages, so a teacher can hand us the file their school gave them.
 *
 * ## What travels
 *
 * Everything on a student except the photograph, which is a picture and not a
 * cell — they are added by hand afterwards, and a spreadsheet column full of
 * base64 would make the file unreadable in the tool it exists to be read in.
 *
 * Groups travel as names rather than ids, because a name is the thing a teacher
 * can type. See `applyStudentCsv` for what happens to a name we do not know.
 */
import { useStore } from '@/data/store';
import type { Group, Student } from '@/data/types';
import { translateNow } from '@/i18n/useT';
import type { TranslationKey } from '@/i18n';
import { accentNames } from '@/theme';

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

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Quote everything, always.
 *
 * Selective quoting means deciding whether a value contains the delimiter, a
 * quote or a newline, and being wrong once is a row that silently shifts by a
 * column. Quoting unconditionally is shorter, cannot be wrong, and every
 * spreadsheet strips them on the way in.
 */
const cell = (value: string) => `"${(value ?? '').replace(/"/g, '""')}"`;

/** The whole roster as a CSV document, header first. */
export function studentsToCsv(students: Student[], groups: Group[]): string {
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));

  const header = COLUMNS.map((c) => cell(translateNow(c.headingKey))).join(',');

  const rows = students.map((s) => {
    const row: CsvRow = {
      id: s.id,
      name: s.name,
      phone: s.phone,
      email: s.email ?? '',
      birthDate: s.birthDate ?? '',
      address: s.address ?? '',
      school: s.school ?? '',
      documentId: s.documentId ?? '',
      parentName: s.parentName ?? '',
      parentPhone: s.parentPhone ?? '',
      parentEmail: s.parentEmail ?? '',
      parentWork: s.parentWork ?? '',
      parent2Name: s.parent2Name ?? '',
      parent2Phone: s.parent2Phone ?? '',
      parent2Email: s.parent2Email ?? '',
      parent2Work: s.parent2Work ?? '',
      groups: s.groupIds
        .map((id) => nameOf.get(id))
        .filter((n): n is string => !!n)
        .join(GROUP_SEPARATOR),
      note: s.note ?? '',
    };
    return COLUMNS.map((c) => cell(row[c.key])).join(',');
  });

  /*
    A BOM, and CRLF line endings.

    Both are for Excel and neither harms anything else: the BOM is what makes it
    read the file as UTF-8 rather than as the local code page, and CRLF is what
    stops older versions running every row together on one line.
  */
  return '﻿' + [header, ...rows].join('\r\n') + '\r\n';
}

/**
 * A file with the right columns and one row showing what goes in them.
 *
 * Offered whenever an import fails, because "could not read that file" on its
 * own leaves the teacher guessing at column names — and they will guess wrong,
 * try again, and give up. A sample they can open in Excel and type over turns a
 * dead end into a two-minute job.
 *
 * The example row is deliberately obvious rubbish rather than plausible data,
 * so nobody imports it by accident and finds a student called Aýgül who does
 * not exist. Only the name and phone are filled in for the second row, to show
 * that everything else is optional.
 */
export function sampleStudentCsv(): string {
  const header = COLUMNS.map((c) => cell(translateNow(c.headingKey))).join(',');

  const example: CsvRow = {
    // Left empty on purpose: an id is how the app recognises a student it
    // already has, and a new one should not claim to be anybody.
    id: '',
    name: 'Aýgül Berdiýewa',
    phone: '+993 65 123456',
    email: 'aygul@example.com',
    birthDate: '2011-03-15',
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
    groups: `IELTS${GROUP_SEPARATOR}Algebra`,
    note: '',
  };

  const minimal = { ...blankRow(), name: 'Batyr Amanow', phone: '+993 65 777888' };

  const rows = [example, minimal].map((r) => COLUMNS.map((c) => cell(r[c.key])).join(','));
  return '\ufeff' + [header, ...rows].join('\r\n') + '\r\n';
}

const blankRow = (): CsvRow =>
  Object.fromEntries(COLUMNS.map((c) => [c.key, ''])) as unknown as CsvRow;

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export class CsvError extends Error {
  constructor(readonly reason: 'empty' | 'noName') {
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

export type ParsedStudent = {
  /** The id from the file, when it carried one. Never trusted blindly. */
  sourceId?: string;
  student: Omit<Student, 'id' | 'groupIds'>;
  /** Group names exactly as written in the cell. */
  groupNames: string[];
};

/** Read a spreadsheet into students, without touching the store. */
export function parseStudentCsv(text: string): ParsedStudent[] {
  const rows = parseRows(text, sniffDelimiter(text));
  if (rows.length < 2) throw new CsvError('empty');

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

  if (index.name === undefined) throw new CsvError('noName');

  const value = (row: string[], key: keyof CsvRow) => {
    const at = index[key];
    return at === undefined ? '' : (row[at] ?? '').trim();
  };

  /** Empty strings become absent, so a blank cell does not overwrite with "". */
  const maybe = (v: string) => (v.length ? v : undefined);

  const out: ParsedStudent[] = [];

  for (const row of rows.slice(1)) {
    const name = value(row, 'name');
    if (!name) continue; // A row with no name is a spacer, not a person.

    out.push({
      sourceId: maybe(value(row, 'id')),
      groupNames: value(row, 'groups')
        .split(/[|;,]/)
        .map((g) => g.trim())
        .filter(Boolean),
      student: {
        name,
        phone: value(row, 'phone'),
        email: maybe(value(row, 'email')),
        birthDate: normaliseDate(value(row, 'birthDate')),
        address: maybe(value(row, 'address')),
        school: maybe(value(row, 'school')),
        documentId: maybe(value(row, 'documentId')),
        parentName: maybe(value(row, 'parentName')),
        parentPhone: maybe(value(row, 'parentPhone')),
        parentEmail: maybe(value(row, 'parentEmail')),
        parentWork: maybe(value(row, 'parentWork')),
        parent2Name: maybe(value(row, 'parent2Name')),
        parent2Phone: maybe(value(row, 'parent2Phone')),
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
export function applyStudentCsv(parsed: ParsedStudent[], mode: 'merge' | 'replace'): ImportOutcome {
  const state = useStore.getState();
  const { addStudent, updateStudent, removeStudent, addGroup } = state;

  const outcome: ImportOutcome = { added: 0, updated: 0, removed: 0, groupsCreated: [] };

  if (mode === 'replace') {
    for (const s of state.students) {
      removeStudent(s.id);
      outcome.removed += 1;
    }
  }

  /** Group ids by lower-cased name, so "IELTS" and "ielts" are one class. */
  const byName = new Map(useStore.getState().groups.map((g) => [g.name.trim().toLowerCase(), g.id]));

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

  for (const row of parsed) {
    const groupIds = groupIdsFor(row.groupNames);
    const existing =
      mode === 'merge' && row.sourceId
        ? useStore.getState().students.find((s) => s.id === row.sourceId)
        : undefined;

    if (existing) {
      updateStudent(existing.id, { ...row.student, groupIds });
      outcome.updated += 1;
    } else {
      addStudent({ ...row.student, groupIds });
      outcome.added += 1;
    }
  }

  return outcome;
}
