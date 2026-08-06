/**
 * Translation.
 *
 * Turkmen is the primary language, not a translation of an English original —
 * `tk` is the source catalogue and the fallback when a Russian key is missing.
 * English is not offered in the interface at all; it survives only in code
 * identifiers and in this comment.
 *
 * Hand-rolled rather than pulling in `i18n-js`, for three reasons: the whole
 * feature is a lookup and a substitution, the key type below makes a missing or
 * misspelt key a compile error instead of a screen showing `messages.title`,
 * and the catalogues have to be readable by the Edge Functions too — the email
 * a parent receives has to be in the same language the teacher chose.
 */
import { catalogue, type TranslationKey } from '@/i18n/catalogue';

export type Language = 'tk' | 'ru' | 'en';

export const LANGUAGES: { code: Language; label: string; english: string }[] = [
  { code: 'tk', label: 'Türkmen dili', english: 'Turkmen' },
  { code: 'ru', label: 'Русский', english: 'Russian' },
  { code: 'en', label: 'English', english: 'English' },
];

export const DEFAULT_LANGUAGE: Language = 'tk';

/**
 * The language, readable without importing the store.
 *
 * `lib/date.ts` needs it to name months and weekdays, and the store already
 * imports `lib/date.ts` — reading the store from there would close an import
 * cycle. This holder breaks it: nothing in `@/i18n` imports anything of ours,
 * so it is always safe to depend on. The store keeps it in step.
 */
let active: Language = DEFAULT_LANGUAGE;
export const setActiveLanguage = (language: Language) => {
  active = language;
};
export const activeLanguage = () => active;

export type { TranslationKey };

/**
 * Look up a key and fill in its placeholders.
 *
 * Placeholders are `{name}` style, matching the ones the message composer
 * already offers teachers, so there is one convention in the product rather
 * than two.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  // Falling back to Turkmen rather than to the key itself: a half-translated
  // Russian build should read as Turkmen, which the teacher can still use, not
  // as `grades.classAverage`, which nobody can.
  const value = catalogue[language]?.[key] ?? catalogue.tk[key] ?? key;
  if (!vars) return value;

  return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
