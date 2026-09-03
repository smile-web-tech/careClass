// ClassCare — the placeholder values, server side.
//
// The composer offers eight placeholders and fills them in per recipient. SMS
// is rendered on the device; email is rendered here, and until now this half
// knew only {name}, {group} and {time}. A teacher writing "{gender} {name}
// bugün gelmedi" got the right sentence in a text and a message with the braces
// still in it in an email.
//
// This is a deliberate port of `src/lib/names.ts` and `src/lib/date.ts` rather
// than a shared package: an Edge Function is a separate Deno deployment and
// cannot import from the app's source tree. The two are kept honest by matching
// tables, so if either changes both have to.

export type Language = 'tk' | 'ru' | 'en';

export const asLanguage = (value: string | null | undefined): Language =>
  value === 'ru' || value === 'en' ? value : 'tk';

/* -------------------------------------------------------------------------- */
/* The gendered noun                                                          */
/* -------------------------------------------------------------------------- */

// Ported from src/lib/names.ts. Female endings are tested first because every
// one of them contains a male one — `owa` ends in `wa` but starts as `ow` — and
// testing the other way round makes every girl in the register a boy.
const FEMALE_ENDINGS = [
  'owa', 'ova', 'ýewa', 'yewa', 'ewa', 'eva', 'gyzy',
  'ова', 'ева', 'ёва', 'ина', 'ская', 'кызы',
];

const MALE_ENDINGS = [
  'ow', 'ov', 'ýew', 'yew', 'ew', 'ev', 'ogly', 'ogli', 'oglu',
  'ов', 'ев', 'ёв', 'ин', 'ский', 'оглы',
];

function genderFromSurname(surname: string): 'male' | 'female' | null {
  const s = surname.trim().toLowerCase().replace(/[^\p{L}]/gu, '');
  if (s.length < 3) return null;
  for (const e of FEMALE_ENDINGS) if (s.endsWith(e)) return 'female';
  for (const e of MALE_ENDINGS) if (s.endsWith(e)) return 'male';
  return null;
}

/** The stored surname, or the last word of the full name for anyone without one. */
function surnameOf(student: { name: string; surname?: string | null }): string {
  const stored = student.surname?.trim();
  if (stored) return stored;
  const parts = student.name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

const CHILD_NOUN: Record<Language, { female: string; male: string; unknown: string }> = {
  tk: { female: 'gyzyňyz', male: 'ogluňyz', unknown: 'çagaňyz' },
  ru: { female: 'ваша дочь', male: 'ваш сын', unknown: 'ваш ребёнок' },
  en: { female: 'your daughter', male: 'your son', unknown: 'your child' },
};

/**
 * "your daughter" / "your son" / "your child".
 *
 * A recorded gender wins; otherwise it is read off the surname, which is what
 * makes this work for a roster nobody filled the field in on. Where even that
 * says nothing the neutral word is used: a message that reads generally is
 * fine, one that calls somebody's daughter their son is not.
 */
export function childNoun(
  student: { name: string; surname?: string | null; gender?: string | null },
  language: Language,
): string {
  const words = CHILD_NOUN[language];
  const known = student.gender === 'male' || student.gender === 'female'
    ? student.gender
    : genderFromSurname(surnameOf(student));
  if (known === 'female') return words.female;
  if (known === 'male') return words.male;
  return words.unknown;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

// Ported from the NAMES table in src/lib/date.ts.
const MONTHS: Record<Language, string[]> = {
  tk: ['Ýanwar', 'Fewral', 'Mart', 'Aprel', 'Maý', 'Iýun', 'Iýul', 'Awgust', 'Sentýabr', 'Oktýabr', 'Noýabr', 'Dekabr'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/**
 * "15 March 2011", from a `YYYY-MM-DD` key.
 *
 * Matches `fullDate` on the device: the year is there because this is a date of
 * birth, and the weekday is not because nobody needs to know a child was born
 * on a Tuesday. Parsed by hand rather than through `new Date`, which would read
 * the key as UTC and hand back the day before for anyone east of Greenwich.
 */
export function fullDate(key: string | null | undefined, language: Language): string {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return '';
  return `${d} ${MONTHS[language][m - 1]} ${y}`;
}
