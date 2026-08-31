/**
 * Taking one thing out of the phone's address book.
 *
 * Two jobs, and the difference matters. Adding a student from a contact fills
 * the whole form — name, number, email. Filling a single phone field takes the
 * number and nothing else: the teacher is on the mother's row, they know whose
 * number it is, and overwriting the name they just typed would be wrong.
 *
 * ## Why the system picker
 *
 * The search-by-name part is already built, on every phone, in the app the
 * teacher uses to ring people. `Contact.presentPicker()` opens exactly that.
 * Reading the address book ourselves to draw our own searchable list would mean
 * asking for `READ_CONTACTS` — a permission that reads as an app hoovering up
 * everyone you know — to rebuild something the phone already does better.
 *
 * A picker the teacher drives needs no such permission: they choose the one
 * contact, and that is all that comes back.
 *
 * ## Why there is a second step
 *
 * The picker returns a *person*, not a number, and people have several. A
 * parent with a work number, a mobile and the landline gives three, and
 * silently taking the first is how a teacher ends up texting a school office
 * about a child's marks. So: one number goes straight in, and more than one
 * asks which — with the labels, because "work" and "mobile" is the whole
 * question.
 */
import * as Contacts from 'expo-contacts';
import { Platform } from 'react-native';

import { showAlert, showDialog } from '@/components/Dialog';
import type { TranslationKey } from '@/i18n';
import { translateNow } from '@/i18n/useT';

const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
  translateNow(key, vars);

/**
 * Whether there is an address book to open.
 *
 * There is not, in a browser. `expo-contacts` still resolves on web and still
 * hands back the picker, and calling it throws — which the callers turn into
 * "ClassCare needs access to your contacts", a message about a permission that
 * has nothing to do with what went wrong and that the teacher cannot act on.
 *
 * So it is answered here, before the call, in words that are true.
 */
async function noAddressBook(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  await showAlert(t('students.importContacts'), t('error.phoneOnly'), 'danger');
  return true;
}

/** What the teacher picked out of a contact, or null if they backed out. */
export type PickedContact = {
  name: string;
  phone: string | null;
  email: string | null;
};

/**
 * One phone number, chosen by the teacher, with nothing else attached.
 *
 * Returns null whenever there is nothing to paste — they dismissed the picker,
 * or the contact they chose has no number at all. Null is not an error and the
 * caller should simply leave the field alone.
 */
export async function pickPhoneNumber(): Promise<string | null> {
  if (await noAddressBook()) return null;
  const contact = await Contacts.Contact.presentPicker();
  if (!contact) return null;

  const phones = await contact.getPhones();
  return choosePhone(phones);
}

/**
 * A whole contact, for filling a blank student form.
 *
 * Only the fields asked for are read. `getDetails` is a real query against the
 * address book, and requesting everything about somebody in order to use three
 * of their fields is both slower and more than the teacher agreed to hand over.
 */
export async function pickContact(): Promise<PickedContact | null> {
  if (await noAddressBook()) return null;
  const contact = await Contacts.Contact.presentPicker();
  if (!contact) return null;

  const details = await contact.getDetails([
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.PHONES,
    Contacts.ContactField.EMAILS,
  ]);

  return {
    name: details.fullName?.trim() ?? '',
    phone: await choosePhone(details.phones ?? []),
    email: details.emails?.[0]?.address?.trim() ?? null,
  };
}

/* -------------------------------------------------------------------------- */

/** Ask which number, but only when there is genuinely a question. */
async function choosePhone(phones: { label?: string; number?: string }[]): Promise<string | null> {
  const numbers: { label?: string; number: string }[] = [];
  for (const phone of phones) {
    const number = phone.number?.trim();
    if (number) numbers.push({ label: phone.label, number });
  }

  if (!numbers.length) {
    await showAlert(t('contacts.noNumberTitle'), t('contacts.noNumberBody'), 'danger');
    return null;
  }

  if (numbers.length === 1) return numbers[0].number;

  /*
    Labelled by what the phone calls them.

    The label is whatever the address book holds — "mobile", "work", öý — and
    is not ours to translate: a teacher recognises their own labels, and
    guessing at a mapping would relabel numbers they filed themselves. Numbers
    with no label at all get the word "number" so the row is not blank.
  */
  const choice = await showDialog({
    title: t('contacts.whichNumber'),
    tone: 'info',
    actions: [
      ...numbers.map((p) => ({
        label: p.label ? `${p.label} · ${p.number}` : p.number,
        value: p.number,
        intent: 'primary' as const,
      })),
      { label: t('common.cancel'), value: '', intent: 'quiet' as const },
    ],
  });

  return choice || null;
}
