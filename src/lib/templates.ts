/**
 * The starter templates every teacher gets.
 *
 * Not rows in `message_templates`: those are what the teacher wrote. These come
 * from the translation catalogue, so they arrive in whichever language was
 * chosen and improve whenever the catalogue does. Seeding them into the
 * database instead would freeze one language into the account on the day it was
 * created, and leave four rows the teacher never asked for.
 *
 * The ids are stable so the attendance flow can deep-link to `absence`.
 */
import type { MessageTemplate } from '@/data/types';
import type { TranslationKey } from '@/i18n';

const BUILT_IN: { id: string; titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { id: 'remind', titleKey: 'template.remindTitle', bodyKey: 'template.remindBody' },
  { id: 'cancel', titleKey: 'template.cancelTitle', bodyKey: 'template.cancelBody' },
  { id: 'absence', titleKey: 'template.absenceTitle', bodyKey: 'template.absenceBody' },
  { id: 'homework', titleKey: 'template.homeworkTitle', bodyKey: 'template.homeworkBody' },
];

export function builtInTemplates(
  t: (key: TranslationKey) => string,
): (MessageTemplate & { builtIn: true })[] {
  return BUILT_IN.map((b) => ({
    id: b.id,
    title: t(b.titleKey),
    body: t(b.bodyKey),
    builtIn: true,
  }));
}
