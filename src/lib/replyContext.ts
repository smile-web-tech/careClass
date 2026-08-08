/**
 * The line under a reply's author: who they are to the teacher.
 *
 * `inbound-email` writes this into the `replies` row when the message arrives,
 * in English, because the server composes it at insert time and has no business
 * guessing what language the teacher will be reading it in months later. So the
 * stored value is treated as a format rather than as prose, and translated on
 * the way to the screen.
 *
 * Doing it here rather than at the source also fixes every reply already in the
 * database, which a change to the function could not.
 *
 * Anything that does not match falls through untouched — a group name is
 * already the teacher's own word for it.
 */
import type { TranslationKey } from '@/i18n';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** `Parent of Amir · Maths B` — the shape the Edge Function writes. */
const PARENT_OF = /^Parent of (.+?)(?: · (.+))?$/;

export function replyContextLabel(context: string, t: Translate): string {
  const trimmed = context.trim();
  if (!trimmed) return '';

  if (trimmed === 'Parent') return t('replies.parent');

  const match = PARENT_OF.exec(trimmed);
  if (!match) return trimmed;

  const [, name, group] = match;
  // The function's own placeholder for a reply it could not tie to a student.
  const who = name === 'a student' ? t('replies.parent') : t('replies.parentOf', { name });

  return group ? `${who} · ${group}` : who;
}
