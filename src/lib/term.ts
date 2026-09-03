/**
 * Terms — the season a course belongs to.
 *
 * A tutor runs the same course again every intake and thinks of each one by its
 * season: the autumn lot, last spring's group. `Group.startsOn` cannot answer
 * that, because a date is a point and a term is a bucket.
 *
 * Stored on the group as a canonical `YYYY-season` key and rendered here, so
 * one database row reads correctly in all three languages.
 */
import type { Group } from '@/data/types';
import type { TranslationKey } from '@/i18n';

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/**
 * Calendar order within a year, which is also the sort order. Winter is first
 * because of how December is handled below.
 */
export const SEASONS: Season[] = ['winter', 'spring', 'summer', 'autumn'];

const SEASON_KEY: Record<Season, TranslationKey> = {
  winter: 'term.winter',
  spring: 'term.spring',
  summer: 'term.summer',
  autumn: 'term.autumn',
};

/** `2026-spring` and nothing else. Matches the check constraint in 0018. */
const TERM_RE = /^(\d{4})-(winter|spring|summer|autumn)$/;

export type ParsedTerm = { year: number; season: Season };

export function parseTerm(term: string | undefined): ParsedTerm | null {
  const m = term ? TERM_RE.exec(term) : null;
  return m ? { year: Number(m[1]), season: m[2] as Season } : null;
}

export const formatTerm = ({ year, season }: ParsedTerm) => `${year}-${season}`;

/**
 * Which term a date falls in.
 *
 * December belongs to the *following* year's winter — a course starting on the
 * 3rd of December 2025 is winter 2026, not winter 2025. That is both how people
 * name a winter that straddles New Year and the only way the four seasons sort
 * into calendar order inside one year: winter, spring, summer, autumn. Keying
 * December to its own year would file it before that year's spring, which is
 * nine months wrong.
 */
export function termOf(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number);
  if (!y || !m) return '';
  if (m === 12) return `${y + 1}-winter`;
  const season: Season = m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  return `${y}-${season}`;
}

/** Chronological. Sorts unparseable terms last rather than throwing them away. */
export function compareTerms(a: string, b: string) {
  const pa = parseTerm(a);
  const pb = parseTerm(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b);
  return pa.year - pb.year || SEASONS.indexOf(pa.season) - SEASONS.indexOf(pb.season);
}

/**
 * "Spring 2026", in the reader's language.
 *
 * Takes the `t` function rather than calling a hook, so this stays usable from
 * the spreadsheet writer and anywhere else outside a component.
 */
export function termLabel(term: string, t: (k: TranslationKey) => string) {
  const parsed = parseTerm(term);
  if (!parsed) return term;
  return `${t(SEASON_KEY[parsed.season])} ${parsed.year}`;
}

/** Every term the teacher actually has, newest first — the filter's options. */
export function termsInUse(groups: Group[]) {
  const seen = new Set<string>();
  for (const g of groups) if (g.term) seen.add(g.term);
  return [...seen].sort((a, b) => compareTerms(b, a));
}

/**
 * The term this course actually states, or nothing when nobody has said.
 *
 * The difference from `termOfGroup` is the last step, and it matters. That one
 * always answers, falling back to the term we are in, because the places that
 * use it are showing a course's history and "no term" is not a useful thing to
 * tell somebody looking at a finished course.
 *
 * This one is allowed to say nothing, and the home screen needs that: a course
 * created by a spreadsheet import has no term and no dates, because a file
 * carries neither, and the honest thing is to show it as waiting for one rather
 * than to file it under whatever season the import happened to run in. A guess
 * put there silently is a guess nobody will ever go back and correct.
 */
export function chosenTerm(group: { term?: string; startsOn?: string }): string | undefined {
  if (group.term) return group.term;
  return group.startsOn ? termOf(group.startsOn) : undefined;
}

/**
 * Every term the teacher has, newest first.
 *
 * The union of two things, and it has to be both. `declared` are the terms they
 * set up on purpose, which is the only way an empty term can exist at all. The
 * groups contribute the rest: a course carrying `2026-autumn` puts that term on
 * the list whether or not anybody declared it, which is what every group made
 * before terms could be declared relies on.
 *
 * Read through `chosenTerm` rather than `termOfGroup`, so a course that states
 * no term contributes none. Inventing the current term for it would put a term
 * on the list that nobody chose, and then quietly file the course there — which
 * is exactly what the import used to do.
 */
export function termsFor(
  declared: string[],
  groups: { term?: string; startsOn?: string }[],
): string[] {
  const seen = new Set(declared);
  for (const g of groups) {
    const term = chosenTerm(g);
    if (term) seen.add(term);
  }
  return [...seen].filter(Boolean).sort((a, b) => compareTerms(b, a));
}

/**
 * The terms to offer when creating a group: the one the start date implies,
 * plus its neighbours either side.
 *
 * A teacher entering a course in late August is as likely to mean the autumn
 * intake as the summer one they are finishing, so the choice has to be there
 * without making them scroll a year of seasons to find it.
 */
export function termChoices(startsOn: string) {
  const here = parseTerm(termOf(startsOn));
  if (!here) return [];
  const out: string[] = [];
  const i = SEASONS.indexOf(here.season);
  for (let d = -1; d <= 2; d += 1) {
    const n = i + d;
    const year = here.year + Math.floor(n / SEASONS.length);
    const season = SEASONS[((n % SEASONS.length) + SEASONS.length) % SEASONS.length];
    out.push(formatTerm({ year, season }));
  }
  return out;
}

/**
 * The term a group belongs to, falling back where it does not carry one.
 *
 * Only groups created or edited since terms existed store one. A teacher who
 * has used the app for a year would otherwise find every course they have ever
 * run belonging to no term at all — invisible to the term filter, unarchivable
 * as a term, and stuck at the bottom of the group list.
 *
 * So: the stored term, else the one the start date implies, else the current
 * one. That last step is not a guess so much as a reading of what a group with
 * no first day and no last day is: still running, therefore this term.
 *
 * Derived on read and never written back. A stored term is the teacher's
 * answer and a derived one is ours, and quietly promoting the second to the
 * first would overwrite a deliberate choice on the next sync.
 */
export function termOfGroup(
  group: { term?: string; startsOn?: string },
  today = new Date(),
): string {
  if (group.term) return group.term;
  if (group.startsOn) return termOf(group.startsOn);
  const local = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return termOf(
    `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`,
  );
}
