/**
 * Class names as a spreadsheet writes them, and what they resolve to.
 *
 * Split out of `data/studentsSheet.ts` so the rules can be tested on their own.
 * Nothing here touches the store or the app — it is string handling and set
 * arithmetic, which is exactly the part of the Groups column that has been
 * wrong before.
 */

/** More than one group in one cell, since a student can be in several. */
export const GROUP_SEP = ', ';

/**
 * Comparison form for a class name.
 *
 * Case and spacing only. Nothing more aggressive, because two classes really
 * can be called "A2" and "A-2" and a teacher who named them that way meant two
 * different classes.
 */
export const groupKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The classes named in one cell.
 *
 * Split on every separator a teacher might reach for rather than only the one
 * this app writes, because the file is as often theirs as ours. Blank entries
 * go, and so do repeats of the same name in one cell — "A2, a2" is one class,
 * and letting it through would ask the resolver to join the same group twice.
 */
export function splitGroups(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of cell.split(/[,;/|\n]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = groupKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Class name to class id, for every class this account holds.
 *
 * Active groups go in first so a name shared with an archived course resolves
 * to the one being taught. Archived ones are still indexed, because a teacher
 * writing last term's course name means *that* course, and making a second
 * active class beside it would be worse than joining the one they named.
 */
export function indexGroupsByName(
  groups: { id: string; name: string; archivedAt?: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) if (!g.archivedAt) out.set(groupKey(g.name), g.id);
  for (const g of groups) if (!out.has(groupKey(g.name))) out.set(groupKey(g.name), g.id);
  return out;
}

/**
 * The memberships a student ends up with: everything they had, plus what the
 * row named.
 *
 * A union and never anything else. This is the whole reason the Groups column
 * is safe to have back: a student keeps every class they were already in —
 * finished courses, archived ones, classes the teacher added by hand and never
 * wrote down — and gains the ones the file names. There is no sequence of
 * imports that can cost anybody a course they have done.
 *
 * Order is preserved, held first, so a re-import does not reshuffle a roster
 * into a different order and make every student look edited.
 */
export function mergeGroupIds(held: string[], named: string[]): string[] {
  return [...new Set([...held, ...named])];
}
