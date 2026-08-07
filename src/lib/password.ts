/**
 * Password strength, scored on the device.
 *
 * Deliberately not zxcvbn: it is ~800 KB of dictionaries, which is a real cost
 * in a bundle a teacher downloads over a slow connection, for a screen shown
 * once. What actually keeps accounts safe is the short list below — length,
 * variety, and a refusal to accept the handful of passwords that appear in
 * every credential-stuffing list. Everything past that is advice, not a gate.
 *
 * The score drives a meter; `problems` drives the block. They are separate on
 * purpose: telling someone their password is merely "fair" and then refusing it
 * without saying why is the single most infuriating thing a signup form does.
 */
import type { TranslationKey } from '@/i18n';

export const MIN_LENGTH = 8;

/** 0 unusable … 4 strong. Indexes straight into the meter's colours. */
export type Score = 0 | 1 | 2 | 3 | 4;

/**
 * A phrase this module wants shown, named rather than written.
 *
 * Keys, not sentences. This file has no business knowing which language the
 * teacher reads — and it cannot ask, because it is called during render from a
 * component that must re-run when the language changes. Returning a key lets
 * `PasswordField` translate it with a subscribed `useT`, so switching language
 * updates the meter along with everything else.
 */
export type Phrase = { key: TranslationKey; vars?: Record<string, string | number> };

export type Strength = {
  score: Score;
  /** Empty for an empty password, where a rating would be meaningless. */
  labelKey: TranslationKey | null;
  /** Blocking. Registration stays disabled while this is non-empty. */
  problems: Phrase[];
  /** The single most useful next step, or null once there is nothing to add. */
  tip: Phrase | null;
};

const LABEL_KEYS = [
  'password.tooWeak',
  'password.weak',
  'password.fair',
  'password.good',
  'password.strong',
] as const satisfies readonly TranslationKey[];

const CLASSES: { test: RegExp; pool: number }[] = [
  { test: /[a-z]/, pool: 26 },
  { test: /[A-Z]/, pool: 26 },
  { test: /[0-9]/, pool: 10 },
  { test: /[^a-zA-Z0-9]/, pool: 33 },
];

/**
 * The passwords that actually get tried first in a stuffing attack, plus the
 * keyboard walks people reach for when a form demands "a number and a symbol".
 * Compared after leet-speak is folded away, so `P@ssw0rd` is caught too.
 */
const COMMON = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'passw0rd',
  'qwerty',
  'qwertyui',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'welcome1',
  'admin',
  'admin123',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'starwars',
  'whatever',
  'zaq12wsx',
  'asdfghjk',
  'zxcvbnm',
  '1q2w3e4r',
  'teacher',
  'teacher1',
  'school',
  'classcare',
]);

/** Rows walked in both directions, so `4321` and `mnbvcx` count too. */
const WALKS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '(': 'c',
  '3': 'e',
  '6': 'g',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
};

const deLeet = (s: string) =>
  s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');

/** Trailing digits and punctuation are decoration, not strength. */
const stripTrim = (s: string) => s.replace(/[^a-z]+$/i, '').replace(/^[^a-z]+/i, '');

function hasWalk(lower: string) {
  for (const row of WALKS) {
    const back = row.split('').reverse().join('');
    for (let i = 0; i + 4 <= lower.length; i++) {
      const chunk = lower.slice(i, i + 4);
      if (row.includes(chunk) || back.includes(chunk)) return true;
    }
  }
  return false;
}

/**
 * `personal` is anything the teacher has already typed into this form — their
 * name, the local part of their email. A password built out of it is guessable
 * by anyone holding the other fields, which in a breach is everyone.
 */
export function scorePassword(password: string, personal: string[] = []): Strength {
  const problems: Phrase[] = [];

  if (password.length === 0) {
    return {
      score: 0,
      labelKey: null,
      problems: [{ key: 'password.choose' }],
      tip: null,
    };
  }

  if (password.length < MIN_LENGTH) {
    problems.push({ key: 'password.useAtLeast', vars: { count: MIN_LENGTH } });
  }

  const lower = password.toLowerCase();

  // Both the literal password and its de-leeted form, each with and without
  // decorative punctuation. Folding alone is not enough: `teacher1` becomes
  // `teacheri`, which matches nothing, so the plain form has to be tried too.
  const candidates = [lower, stripTrim(lower), deLeet(password), stripTrim(deLeet(password))];
  if (candidates.some((c) => COMMON.has(c))) {
    problems.push({ key: 'password.tooCommon' });
  }

  for (const raw of personal) {
    const token = raw.trim().toLowerCase();
    if (token.length >= 4 && lower.includes(token)) {
      problems.push({ key: 'password.noPersonal' });
      break;
    }
  }

  // Entropy of the alphabet actually used, which is the honest upper bound on
  // how long a brute force takes — not a count of ticked checkboxes.
  const pool = CLASSES.reduce((sum, c) => sum + (c.test.test(password) ? c.pool : 0), 0);
  const used = CLASSES.filter((c) => c.test.test(password)).length;
  let bits = password.length * Math.log2(Math.max(pool, 2));

  if (/(.)\1{2,}/.test(password)) bits -= 10; // "aaa"
  if (hasWalk(lower)) bits -= 14; // "1234", "qwer"
  if (/^[a-z]+[0-9]{1,4}$/i.test(password)) bits -= 8; // word + year

  const graded: Score = bits < 30 ? 1 : bits < 44 ? 2 : bits < 60 ? 3 : 4;

  // A password that breaks a hard rule is a 0 whatever its arithmetic says.
  // Below "Fair" it is refused too — and that refusal is stated as a problem
  // rather than left implicit, so the disabled button always has a reason
  // printed next to it.
  const score: Score = problems.length > 0 ? 0 : graded;
  if (problems.length === 0 && graded < 2) {
    problems.push({ key: 'password.tooGuessable' });
  }

  let tip: Phrase | null = null;
  if (score < 4) {
    // Below the hard minimum, say *that* — advice about reaching twelve is
    // noise when the password is not yet long enough to be accepted at all.
    if (password.length < MIN_LENGTH) tip = { key: 'auth.minChars', vars: { count: MIN_LENGTH } };
    else if (password.length < 12) tip = { key: 'password.tipLonger' };
    else if (used < 3) tip = { key: 'password.tipMix' };
    else if (hasWalk(lower)) tip = { key: 'password.tipRuns' };
    else tip = { key: 'password.tipWords' };
  }

  return { score, labelKey: LABEL_KEYS[score], problems, tip };
}

/**
 * The one thing call sites care about: may this password be submitted?
 *
 * `problems` is the single source of truth — everything that blocks, including
 * being merely weak, ends up in there with words attached.
 */
export const passwordAcceptable = (s: Strength) => s.problems.length === 0;
