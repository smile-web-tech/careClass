/**
 * The hook screens use to translate.
 *
 *     const t = useT();
 *     <Text>{t('grades.classAverage')}</Text>
 *     <Text>{t('messages.reaches', { count: 11 })}</Text>
 *
 * Reading the language straight from the store rather than a React context, so
 * a screen re-renders when it changes without every screen needing a provider
 * above it — and so `translateNow` below can answer outside the tree.
 */
import { useCallback } from 'react';

import { useStore } from '@/data/store';
import { translate, type Language, type TranslationKey } from '@/i18n';

export function useLanguage(): Language {
  return useStore((s) => s.language);
}

export function useT() {
  const language = useLanguage();
  return useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
}

/**
 * Translate from outside a component — `lib/errors.ts`, `data/sync.ts`, the
 * imperative dialogs. Reads the language at call time, which is what you want
 * for a message that is about to be shown.
 */
export function translateNow(key: TranslationKey, vars?: Record<string, string | number>) {
  return translate(useStore.getState().language, key, vars);
}
