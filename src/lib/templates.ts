/**
 * The starter templates every teacher gets.
 *
 * Not rows in `message_templates`: those are what the teacher wrote. These come
 * from the translation catalogue, so they arrive in whichever language was
 * chosen and improve whenever the catalogue does. Seeding them into the
 * database instead would freeze one language into the account on the day it was
 * created, and leave four rows the teacher never asked for.
 *
 * The ids are stable so the attendance flow can deep-link to `absence` — which
 * is also why editing one stores an override against that id rather than
 * copying it into a new row: the link keeps working, and the teacher's words
 * are the ones that appear.
 */
import type { MessageTemplate } from '@/data/types';
import type { TranslationKey } from '@/i18n';

const BUILT_IN: { id: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { id: 'remind', titleKey: 'template.remindTitle', bodyKey: 'template.remindBody' },
  { id: 'cancel', titleKey: 'template.cancelTitle', bodyKey: 'template.cancelBody' },
  { id: 'absence', titleKey: 'template.absenceTitle', bodyKey: 'template.absenceBody' },
  { id: 'homework', titleKey: 'template.homeworkTitle', bodyKey: 'template.homeworkBody' },
  // Last, deliberately. `starters[0]` is what the composer opens with when it
  // was not sent to a particular template, and that should stay the reminder.
  { id: 'birthday', titleKey: 'template.birthdayTitle', bodyKey: 'template.birthdayBody' },
];

/**
 * What the teacher has done to the starters.
 *
 * Overrides keep the id and replace the words; hidden ids drop out of the list
 * entirely. Both live in the store as settings rather than as rows, because
 * neither is a template — they are statements about the four that ship with the
 * app.
 */
export type TemplateEdits = {
  overrides?: Record<string, { title: string; body: string }>;
  hidden?: string[];
};

export function builtInTemplates(
  t: (key: TranslationKey) => string,
  edits: TemplateEdits = {},
): (MessageTemplate & { builtIn: true; edited: boolean })[] {
  const hidden = new Set(edits.hidden ?? []);

  return BUILT_IN.filter((b) => !hidden.has(b.id)).map((b) => {
    const own = edits.overrides?.[b.id];
    return {
      id: b.id,
      title: own?.title ?? t(b.titleKey),
      body: own?.body ?? t(b.bodyKey),
      builtIn: true,
      // Shown as a small note in the list, so a teacher can tell which of the
      // four they have rewritten and which still follow their language.
      edited: !!own,
    };
  });
}

/** The untouched wording, for the reset button in the editor. */
export function builtInDefault(
  t: (key: TranslationKey) => string,
  id: string,
): { title: string; body: string } | null {
  const b = BUILT_IN.find((x) => x.id === id);
  return b ? { title: t(b.titleKey), body: t(b.bodyKey) } : null;
}
