/**
 * Who made this and how to reach them.
 *
 * One place, because there were two: About showed one address and the Support
 * row in Profile mailed another, and nothing would have caught them drifting
 * apart. A teacher writing to the address on the About screen and getting no
 * answer is not a bug anyone reports — they just stop writing.
 */

export const DEVELOPER = 'Baylyyev Kerven';
export const SUPPORT_EMAIL = 'kervenbalkan@gmail.com';

/**
 * The address account mail arrives from.
 *
 * Shown on the "check your inbox" screen so a teacher hunting through a spam
 * folder knows what to look for. It must match `RESEND_FROM` on the server —
 * telling somebody to look for an address nothing sends from is worse than
 * saying nothing.
 */
export const MAIL_SENDER = 'notifications@smiletech.dev';
