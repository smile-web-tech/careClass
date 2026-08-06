import type { Group, Session, Weekday } from '@/data/types';
import { addDays, at, minutesOf, startOfDay, toKey } from '@/lib/date';

/** Sessions are derived, so their ids must be reconstructible from the parts. */
export const sessionId = (groupId: string, dateKey: string) => `${groupId}@${dateKey}`;

export function parseSessionId(id: string) {
  const [groupId, date] = id.split('@');
  return { groupId, date };
}

/** Every session across all groups on one calendar day, earliest first. */
export function sessionsOn(groups: Group[], date: Date): Session[] {
  const key = toKey(date);
  const day = date.getDay() as Weekday;

  return groups
    .flatMap((g) =>
      g.slots
        .filter((s) => s.day === day)
        .map<Session>((s) => ({
          id: sessionId(g.id, key),
          groupId: g.id,
          date: key,
          start: s.start,
          end: s.end,
        })),
    )
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
}

/**
 * A group can meet more than once a day in theory; in that case the derived id
 * would collide. Disambiguate by appending the start time when needed.
 */
export function uniqueSessionKey(s: Session) {
  return `${s.groupId}@${s.date}#${s.start}`;
}

/** The next session for one group at or after `from`, scanning up to a fortnight. */
export function nextSessionForGroup(group: Group, from = new Date()): Session | null {
  for (let i = 0; i < 14; i++) {
    const day = addDays(from, i);
    for (const s of sessionsOn([group], day)) {
      if (at(s.date, s.start).getTime() >= from.getTime() || i > 0) return s;
    }
  }
  return null;
}

/**
 * The teacher's next class across every group — what the home hero card shows.
 * A session counts as "next" until its end time, so the card stays useful while
 * a lesson is actually running.
 */
export function nextSessionOverall(groups: Group[], from = new Date()): Session | null {
  for (let i = 0; i < 14; i++) {
    for (const s of sessionsOn(groups, addDays(from, i))) {
      if (at(s.date, s.end).getTime() >= from.getTime()) return s;
    }
  }
  return null;
}

/** Sessions in the Monday-first week containing `anchor`, grouped by day key. */
export function sessionsForWeek(groups: Group[], days: Date[]) {
  const out: Record<string, Session[]> = {};
  for (const d of days) out[toKey(d)] = sessionsOn(groups, d);
  return out;
}

/** "Mon · Wed · Fri" — the schedule chip on the group header. */
export function slotDaysLabel(group: Group) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const uniq = [...new Set(group.slots.map((s) => s.day))].sort(
    // Monday-first ordering.
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
  return uniq.map((d) => names[d]).join(' · ');
}

/** "16:00 – 17:30", or "varies" when the group meets at different times. */
export function slotTimeLabel(group: Group) {
  const times = [...new Set(group.slots.map((s) => `${s.start} – ${s.end}`))];
  return times.length === 1 ? times[0] : 'Varies';
}

/** Past / current / upcoming, used for the calendar session badges. */
export function sessionPhase(s: Session, now = new Date()): 'done' | 'live' | 'next' | 'later' {
  const start = at(s.date, s.start);
  const end = at(s.date, s.end);
  if (end.getTime() < now.getTime()) return 'done';
  if (start.getTime() <= now.getTime()) return 'live';
  return startOfDay(start).getTime() === startOfDay(now).getTime() ? 'next' : 'later';
}

/**
 * A room to show, given one that may be blank.
 *
 * Older groups have the literal string "No room" saved in the database, from
 * back when the form wrote that instead of leaving the field empty. Both are
 * treated as absence here so the label translates either way.
 */
export function roomLabel(room: string, t: (key: 'groups.noRoom') => string) {
  const value = room?.trim();
  return !value || value === 'No room' ? t('groups.noRoom') : value;
}
