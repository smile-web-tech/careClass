/**
 * Names, and what a Turkmen surname says about who is carrying it.
 *
 * Turkmen surnames are patronymic and gendered, in both the scripts a roster
 * here is written in. `-ow`/`-ýew` and their Russian spellings `-ов`/`-ев` are
 * a son; `-owa`/`-ýewa`, `-ова`/`-ева` are a daughter. So the teacher who has
 * typed "Berdiýewa" has already said which one, and asking them again in a
 * separate field is asking them to repeat themselves sixty times.
 *
 * This is a *suggestion* and is treated as one everywhere it is used. It fills
 * a gender that is not set and never overwrites one that is, because the
 * endings do not cover everybody: a name from another tradition has no suffix
 * to read, and a teacher who has corrected the guess has to have that stick.
 */
import type { Gender } from '@/data/types';

/**
 * Endings that decide it, longest first within each list.
 *
 * Order across the two lists matters more than it looks: every female ending
 * here contains a male one — `owa` ends in `wa` but starts as `ow` — so the
 * female endings are tested first, and testing them the other way round would
 * make every girl in the register a boy.
 */
const FEMALE_ENDINGS = [
  // Turkmen Latin
  'owa',
  'ova',
  'ýewa',
  'yewa',
  'ewa',
  'eva',
  'gyzy',
  // Russian Cyrillic
  'ова',
  'ева',
  'ёва',
  'ина',
  'ская',
  'кызы',
];

const MALE_ENDINGS = [
  // Turkmen Latin
  'ow',
  'ov',
  'ýew',
  'yew',
  'ew',
  'ev',
  'ogly',
  'ogli',
  'oglu',
  // Russian Cyrillic
  'ов',
  'ев',
  'ёв',
  'ин',
  'ский',
  'оглы',
];

/**
 * Which gender a surname implies, or nothing when it implies nothing.
 *
 * Case and the two Turkmen letters that have look-alikes (`ý`, `w`) are handled
 * by lower-casing and by listing both spellings, because a teacher typing on a
 * Russian keyboard writes "Berdieva" and one on a Turkmen keyboard writes
 * "Berdiýewa", and they mean the same child.
 */
export function genderFromSurname(surname: string): Gender | undefined {
  const s = surname.trim().toLowerCase().replace(/[^\p{L}]/gu, '');
  if (s.length < 3) return undefined;

  for (const ending of FEMALE_ENDINGS) if (s.endsWith(ending)) return 'female';
  for (const ending of MALE_ENDINGS) if (s.endsWith(ending)) return 'male';
  return undefined;
}

/**
 * Split a full name into given name and surname.
 *
 * The *last* word is the surname, and everything before it is the given name.
 * That is the order these rosters are written in, and it is also the safe way
 * round: a child with two given names keeps both, where splitting on the first
 * space would give them a surname of "Nurmuhammedowa" belonging to somebody
 * else entirely.
 *
 * A single word is a given name with no surname, not a surname with no given
 * name — a teacher who has typed one word has typed what they call the child.
 */
export function splitName(full: string): { given: string; surname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { given: parts[0] ?? '', surname: '' };
  return { given: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

/** Given name and surname back into the one string the app displays. */
export function joinName(given: string, surname: string): string {
  return [given.trim(), surname.trim()].filter(Boolean).join(' ');
}

/**
 * The surname to read a gender from, for a student who may predate the column.
 *
 * Falls back to the last word of the full name, which is what `surname` would
 * have been had the field existed when they were entered.
 */
export function surnameOf(student: { name: string; surname?: string }): string {
  return student.surname?.trim() || splitName(student.name).surname;
}

/**
 * The given-name half of a stored name.
 *
 * Takes the stored surname off the end when it is there and the name really
 * ends with it, which is the case for anyone entered since the field existed.
 * Otherwise it falls back to the split, so a student whose surname was never
 * recorded still opens the form with their name in the right two boxes.
 */
export function givenOf(student: { name: string; surname?: string }): string {
  const surname = student.surname?.trim();
  if (surname) {
    const name = student.name.trim();
    if (name.toLowerCase().endsWith(surname.toLowerCase())) {
      return name.slice(0, name.length - surname.length).trim();
    }
  }
  return splitName(student.name).given;
}
