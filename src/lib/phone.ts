/**
 * Turning what a teacher typed into something a network will accept.
 *
 * The form's placeholder is `+993 65 000000`, so that is what gets typed —
 * spaces and all. That string was then handed straight to `SmsManager`, which
 * does not tolerate separators the way a dialer does: on most Android builds it
 * comes back as `RESULT_ERROR_GENERIC_FAILURE`, which the app reported as "the
 * operator did not accept it" even when the message had in fact gone out. A
 * teacher watching half their class receive a text while the app called it a
 * failure is the exact bug this exists to remove.
 *
 * Turkmenistan is +993. Mobile numbers are eight digits nationally and start
 * with a 6; the old domestic trunk prefix is a leading 8, which people still
 * write out of habit.
 *
 * Anything that does not match a shape we recognise is passed through with only
 * its separators removed. Guessing a country code onto a number we do not
 * understand would send somebody's message to a stranger.
 */

/** Turkmenistan. */
const COUNTRY_CODE = '993';

/** National subscriber number length, mobile and landline alike. */
const NATIONAL_LENGTH = 8;

/**
 * E.164 where the shape is recognisable, separators stripped otherwise.
 *
 * ```
 * '+993 65 123456'  ->  '+99365123456'
 * '65 12 34 56'     ->  '+99365123456'
 * '8 65 123456'     ->  '+99365123456'
 * '0099365123456'   ->  '+99365123456'
 * '112'             ->  '112'
 * ```
 */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Everything but digits, and a `+` only where it belongs: at the front.
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Already international, either written with a + or dialled with 00.
  if (hadPlus) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  // Written with the country code but no plus: 993 65 123456.
  if (digits.startsWith(COUNTRY_CODE) && digits.length === COUNTRY_CODE.length + NATIONAL_LENGTH) {
    return `+${digits}`;
  }

  // The domestic trunk prefix. Dialling 8 first is how a landline is used
  // here, and it is how plenty of numbers end up written down.
  if (digits.startsWith('8') && digits.length === NATIONAL_LENGTH + 1) {
    return `+${COUNTRY_CODE}${digits.slice(1)}`;
  }

  // A bare national number.
  if (digits.length === NATIONAL_LENGTH) return `+${COUNTRY_CODE}${digits}`;

  // Short codes, foreign numbers written oddly, half-typed entries. Stripped
  // of separators, which is the part that actually breaks sending, and
  // otherwise left exactly as the teacher meant it.
  return digits;
}

/** Whether a number is long enough to be worth attempting at all. */
export const looksSendable = (input: string) =>
  normalisePhone(input).replace(/\D/g, '').length >= 6;
