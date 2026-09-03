/**
 * What a placeholder in a message body stands for.
 *
 * The composer offers `{name}`, `{group}` and the rest as chips, and every one
 * of them is filled in per recipient: thirty parents get thirty different
 * messages out of one draft. This is the part that decides what each one says.
 *
 * ## `{gender}` is not "male" or "female"
 *
 * It renders the word a teacher would actually write to a parent — `gyzyňyz`,
 * `ogluňyz`, "your daughter", "your son" — because that is the only reason to
 * want the gender in a message at all. Nobody texts a parent the word "female".
 *
 * Which means it is a *relationship* noun and it is written from the parent's
 * side. A message sent to the student themselves gets the same word, and the
 * teacher writing "Habar: {gender} ..." has to know that. It is documented on
 * the chip's hint rather than guessed at, because the alternative — quietly
 * substituting something different depending on who the message is going to —
 * is a draft that does not say what the preview said.
 *
 * The gender comes from `genderOf`, so it is read off the surname for the whole
 * roster rather than only for students somebody filled the field in on. Where
 * even that says nothing, the neutral word is used: `çagaňyz`, "your child". A
 * message that reads slightly generally is fine; one that calls somebody's
 * daughter their son is not.
 */
import type { Student } from '@/data/types';
import { translateNow } from '@/i18n/useT';
import { fromKey, fullDate } from '@/lib/date';
import { genderOf } from '@/lib/names';

/** Every placeholder the composer offers, in the order the chips show them. */
export const PLACEHOLDERS = [
  '{name}',
  '{group}',
  '{time}',
  '{gender}',
  '{parent_name}',
  '{phone}',
  '{address}',
  '{birthdate}',
] as const;

export type MessageVars = {
  /** The student's name, even in a message to a parent. */
  name: string;
  group: string;
  time: string;
  gender: string;
  parentName: string;
  phone: string;
  address: string;
  birthDate: string;
};

/** "your daughter" / "your son" / "your child", in the app's language. */
export function childNoun(student: Pick<Student, 'name' | 'surname' | 'gender'>): string {
  const gender = genderOf(student);
  if (gender === 'female') return translateNow('msgvar.daughter');
  if (gender === 'male') return translateNow('msgvar.son');
  return translateNow('msgvar.child');
}

/**
 * The values for one recipient.
 *
 * `parentName` falls back to the father when there is no mother on file, and
 * the other way round, so `{parent_name}` in a message to whichever parent we
 * actually hold says a name rather than nothing. Everything else is empty when
 * it is not recorded — an empty gap reads as a small mistake, where the literal
 * text `{address}` arriving on a parent's phone reads as a broken app.
 */
export function varsFor(
  student: Student,
  group: { name: string } | undefined,
  time: string,
): MessageVars {
  return {
    name: student.name,
    group: group?.name ?? '',
    time,
    gender: childNoun(student),
    parentName: student.parentName?.trim() || student.parent2Name?.trim() || '',
    phone: student.phone?.trim() ?? '',
    address: student.address?.trim() ?? '',
    birthDate: student.birthDate ? fullDate(fromKey(student.birthDate)) : '',
  };
}

/**
 * Substitute every placeholder.
 *
 * `replaceAll` on literals rather than one regex over the lot: a name or an
 * address can itself contain a brace, and a pattern that rewrote whatever came
 * back would be substituting into the answer.
 */
export function renderBody(template: string, vars: MessageVars): string {
  return template
    .replaceAll('{name}', vars.name)
    .replaceAll('{group}', vars.group)
    .replaceAll('{time}', vars.time)
    .replaceAll('{gender}', vars.gender)
    .replaceAll('{parent_name}', vars.parentName)
    .replaceAll('{phone}', vars.phone)
    .replaceAll('{address}', vars.address)
    .replaceAll('{birthdate}', vars.birthDate);
}
