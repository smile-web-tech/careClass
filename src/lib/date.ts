/** Local-time date helpers. Everything the app shows is in the teacher's own timezone. */
import { activeLanguage, translate, type Language } from '@/i18n';

/** Short form of the translator, for this module's relative-time words. */
const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate(activeLanguage(), key, vars);

/**
 * Day and month names, per language.
 *
 * Not `Intl.DateTimeFormat`: React Native ships a trimmed ICU on Android, so
 * asking it for Turkmen month names returns English on most devices. These are
 * short enough to state outright and are then guaranteed correct everywhere.
 *
 * Read through `useStore` at call time rather than passed in, because these are
 * used by plain formatting helpers that screens call inline.
 */
const NAMES: Record<Language, { dowShort: string[]; dowLong: string[]; monthShort: string[]; monthLong: string[] }> = {
  tk: {
    dowShort: ['Ýek', 'Duş', 'Siş', 'Çar', 'Pen', 'Ann', 'Şen'],
    dowLong: [
      'Ýekşenbe',
      'Duşenbe',
      'Sişenbe',
      'Çarşenbe',
      'Penşenbe',
      'Anna',
      'Şenbe',
    ],
    monthShort: ['Ýan', 'Few', 'Mart', 'Apr', 'Maý', 'Iýun', 'Iýul', 'Awg', 'Sen', 'Okt', 'Noý', 'Dek'],
    monthLong: [
      'Ýanwar',
      'Fewral',
      'Mart',
      'Aprel',
      'Maý',
      'Iýun',
      'Iýul',
      'Awgust',
      'Sentýabr',
      'Oktýabr',
      'Noýabr',
      'Dekabr',
    ],
  },
  ru: {
    dowShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    dowLong: [
      'Воскресенье',
      'Понедельник',
      'Вторник',
      'Среда',
      'Четверг',
      'Пятница',
      'Суббота',
    ],
    monthShort: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
    monthLong: [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ],
  },
  en: {
    dowShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dowLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    monthShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthLong: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
};

const names = () => NAMES[activeLanguage()] ?? NAMES.tk;

/** `YYYY-MM-DD` in *local* time — `toISOString` would shift across UTC. */
export function toKey(d: Date) {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-first week containing `d`. */
export function startOfWeek(d: Date) {
  const s = startOfDay(d);
  const shift = (s.getDay() + 6) % 7;
  return addDays(s, -shift);
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const dowShort = (d: Date) => names().dowShort[d.getDay()];
export const dowLong = (d: Date) => names().dowLong[d.getDay()];
export const monthLong = (d: Date) => names().monthLong[d.getMonth()];
export const monthShort = (d: Date) => names().monthShort[d.getMonth()];

export const isSameDay = (a: Date, b: Date) => toKey(a) === toKey(b);

/** "Friday 31 July" — the home screen eyebrow. */
export const longDate = (d: Date) => `${dowLong(d)} ${d.getDate()} ${monthLong(d)}`;

/** "Fri 31 Jul" — compact form used in nav bars and session lists. */
export const shortDate = (d: Date) => `${dowShort(d)} ${d.getDate()} ${monthShort(d)}`;

/**
 * "Fri 31 Jul at 16:05" — for a single item's own screen.
 *
 * A list shows "2h ago", which is the right unit while scanning. Once the
 * teacher has opened one thing, the exact time is what they need — usually to
 * work out whether it arrived before or after a lesson.
 */
export const longDateTime = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${shortDate(d)} ${tr('time.at')} ${hh}:${mm}`;
};

/** Minutes since local midnight for an `HH:mm` string. */
export function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Combine a `YYYY-MM-DD` key and an `HH:mm` time into a local Date. */
export function at(dateKey: string, hhmm: string) {
  const d = fromKey(dateKey);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * "in 2h 12m" / "in 45m" / "now" — the countdown on the home hero card.
 * Past a day the minute count stops being useful, so it degrades to the day.
 */
export function countdownTo(target: Date, now = new Date()) {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return tr('time.now');

  const days = Math.round((startOfDay(target).getTime() - startOfDay(now).getTime()) / 86400000);
  if (days === 1) return tr('time.tomorrow');
  if (days > 1) return dowLong(target);

  const h = Math.floor(mins / 60);
  return tr('time.inTime', { time: `${h > 0 ? `${h}h ` : ''}${mins % 60}m` });
}

/** "Today 16:00" / "Tomorrow 10:30" / "Wed 18:00" — group list subtitle. */
export function relativeSlot(when: Date, now = new Date()) {
  const time = `${`${when.getHours()}`.padStart(2, '0')}:${`${when.getMinutes()}`.padStart(2, '0')}`;
  const days = Math.round((startOfDay(when).getTime() - startOfDay(now).getTime()) / 86400000);
  if (days === 0) return { label: `${tr('time.today')} ${time}`, imminent: true };
  if (days === 1) return { label: `${tr('time.tomorrowCap')} ${time}`, imminent: false };
  return { label: `${dowShort(when)} ${time}`, imminent: false };
}

/** "18 min ago" / "2h ago" / "Yesterday" / "Wed" — message + reply timestamps. */
export function timeAgo(ts: number, now = Date.now()) {
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return tr('time.justNow');
  if (mins < 60) return tr('time.minAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 12) return tr('time.hoursAgo', { count: hours });
  const days = Math.round(
    (startOfDay(new Date(now)).getTime() - startOfDay(new Date(ts)).getTime()) / 86400000,
  );
  if (days <= 0) return tr('time.hoursAgo', { count: hours });
  if (days === 1) return tr('time.yesterday');
  if (days < 7) return dowShort(new Date(ts));
  return shortDate(new Date(ts));
}

/**
 * The 6×7 grid a month view renders: whole weeks, padded with the tail of the
 * previous month and the head of the next so every row has seven cells.
 *
 * Always six rows, never five — a grid that changes height as you page through
 * months makes the content below it jump.
 */
export function monthMatrix(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
}

/** Same calendar month and year — used to dim the padding days in a month grid. */
export const isSameMonth = (a: Date, b: Date) =>
  a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

/** `2026-08-04` → a readable `4 Aug`. */
export const dayMonth = (d: Date) => `${d.getDate()} ${monthShort(d)}`;
