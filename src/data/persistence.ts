/**
 * Keeping the in-memory store and the on-device database in step.
 *
 * The store is what screens read: synchronous, and already wired into every
 * component. `localDb` is where it lives between launches. This module is the
 * strap between them — it loads the database into the store at startup, and
 * writes each collection back whenever it changes.
 *
 * Writes are coalesced rather than immediate. Marking a register of thirty
 * changes the attendance object thirty times in as many seconds, and thirty
 * transactions for one register is work nobody asked for. A short delay after
 * the last change writes once.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import {
  clearLocalData,
  loadSnapshot,
  replaceCollection,
  writeSetting,
  type Collection,
} from '@/data/localDb';
import { useStore } from '@/data/store';
import { isLanguage, setActiveLanguage } from '@/i18n';

/** Long enough to batch a burst of edits, short enough to survive a swipe-kill. */
const WRITE_DELAY_MS = 400;

/** The key the old `zustand/persist` blob was stored under. */
const LEGACY_KEY = 'classcare-v1';

type State = ReturnType<typeof useStore.getState>;

/**
 * Which store field goes to which table, and how a row is keyed.
 *
 * Attendance is the odd one: it is a map keyed by `groupId@date#start` rather
 * than a list of objects with ids, and that key is what the rest of the app
 * looks sessions up by.
 */
const TABLES: {
  table: Collection;
  read: (s: State) => unknown;
  rows: (s: State) => { id: string; value: unknown }[];
}[] = [
  {
    table: 'groups',
    read: (s) => s.groups,
    rows: (s) => s.groups.map((g) => ({ id: g.id, value: g })),
  },
  {
    table: 'students',
    read: (s) => s.students,
    rows: (s) => s.students.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'attendance',
    read: (s) => s.attendance,
    rows: (s) => Object.entries(s.attendance).map(([id, value]) => ({ id, value })),
  },
  {
    table: 'messages',
    read: (s) => s.messages,
    rows: (s) => s.messages.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'replies',
    read: (s) => s.replies,
    rows: (s) => s.replies.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'events',
    read: (s) => s.events,
    rows: (s) => s.events.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'assessments',
    read: (s) => s.assessments,
    rows: (s) => s.assessments.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'assessment_types',
    read: (s) => s.assessmentTypes,
    rows: (s) => s.assessmentTypes.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'grades',
    read: (s) => s.grades,
    rows: (s) => s.grades.map((x) => ({ id: x.id, value: x })),
  },
  {
    table: 'templates',
    read: (s) => s.templates,
    rows: (s) => s.templates.map((x) => ({ id: x.id, value: x })),
  },
];

/** Everything that is a setting rather than a collection. */
const SETTINGS = [
  'signedIn',
  'offline',
  'teacherId',
  'teacherName',
  'teacherEmail',
  'teacherAvatarUrl',
  'teacherProvider',
  'gradeTemplate',
  'gradeTemplateFail',
  'language',
  'languageChosen',
  'permissionsAsked',
  'remindersOn',
  'reminderLead',
  'templateOverrides',
  'hiddenTemplates',
] as const;

type SettingKey = (typeof SETTINGS)[number];

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fill the store from the database, and from the old blob the first time.
 *
 * Returns once the store is safe to render from. The root layout holds the
 * splash screen until it resolves, because a first frame drawn from an empty
 * store sends a signed-in teacher to the welcome screen for a moment — which
 * looks exactly like being signed out.
 */
export async function loadLocal(): Promise<void> {
  const snapshot = await loadSnapshot();

  const empty =
    snapshot.groups.length === 0 &&
    snapshot.students.length === 0 &&
    Object.keys(snapshot.settings).length === 0;

  if (empty) {
    const imported = await importLegacyBlob();
    if (imported) return;
  }

  const settings = snapshot.settings as Partial<Record<SettingKey, unknown>>;

  useStore.setState({
    groups: snapshot.groups,
    students: snapshot.students,
    attendance: snapshot.attendance,
    messages: snapshot.messages,
    replies: snapshot.replies,
    events: snapshot.events,
    assessments: snapshot.assessments,
    assessmentTypes: snapshot.assessmentTypes,
    grades: snapshot.grades,
    templates: snapshot.templates,
    ...(pickSettings(settings) as Partial<State>),
  });

  applyLanguage();
  await turnRemindersOnOnce(settings);
}

/**
 * Switch class reminders on, once, for phones that saved the old default.
 *
 * They used to default to off. A teacher who granted notifications on the way
 * in — on a screen that says the app will remind them before a class — then got
 * nothing, because the switch that actually schedules anything was in Profile
 * and off. The default is now on, but a device that has already written `false`
 * would keep it forever, so it is flipped here and the flip is recorded so a
 * teacher who deliberately turns them off again is left alone.
 */
async function turnRemindersOnOnce(settings: Record<string, unknown>) {
  if (settings.remindersDefaultedOn) return;

  useStore.setState({ remindersOn: true });
  try {
    await writeSetting('remindersOn', true);
    await writeSetting('remindersDefaultedOn', true);
  } catch {
    // Worst case it runs again next launch, which costs one write.
  }
}

/**
 * One-time move from `zustand/persist`.
 *
 * Teachers already have a term of work in the AsyncStorage blob. Reading it
 * once, writing it into the tables and leaving the original alone means an
 * upgrade loses nothing — and that a build rolled back to the old version
 * still finds its data where it left it.
 */
async function importLegacyBlob(): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(LEGACY_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const state = parsed?.state;
    if (!state) return false;

    useStore.setState(state as Partial<State>);
    applyLanguage();

    // Write it straight back out as tables, so the next launch reads from
    // SQLite and this path never runs again.
    await flushAll();
    return true;
  } catch (e) {
    console.warn('[classcare] could not read the previous local data:', e);
    return false;
  }
}

function pickSettings(settings: Partial<Record<SettingKey, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const key of SETTINGS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

/** The catalogue holder is not the store, so it has to be told separately. */
function applyLanguage() {
  const language = useStore.getState().language;
  if (isLanguage(language)) setActiveLanguage(language);
}

/* -------------------------------------------------------------------------- */
/* Saving                                                                     */
/* -------------------------------------------------------------------------- */

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingTables = new Set<Collection>();
let pendingSettings = new Set<SettingKey>();
let writing: Promise<void> = Promise.resolve();

/** Previous values, by reference, so an unrelated change writes nothing. */
let last: State | null = null;

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, WRITE_DELAY_MS);
}

function flush(): Promise<void> {
  const tables = [...pendingTables];
  const settings = [...pendingSettings];
  pendingTables = new Set();
  pendingSettings = new Set();
  if (!tables.length && !settings.length) return writing;

  const state = useStore.getState();

  // Chained rather than parallel: two transactions racing on the same table
  // would be serialised by SQLite anyway, and in order is easier to reason
  // about when something goes wrong.
  writing = writing
    .then(async () => {
      for (const table of tables) {
        const entry = TABLES.find((x) => x.table === table);
        if (entry) await replaceCollection(table, entry.rows(state));
      }
      for (const key of settings) {
        await writeSetting(key, state[key as keyof State]);
      }
    })
    .catch((e) => {
      // Nothing the teacher can act on, and the data is still in memory — the
      // next change writes the whole collection again.
      console.warn('[classcare] could not save locally:', e);
    });

  return writing;
}

/** Write everything now, regardless of what changed. */
export async function flushAll(): Promise<void> {
  for (const entry of TABLES) pendingTables.add(entry.table);
  for (const key of SETTINGS) pendingSettings.add(key);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}

/**
 * Start writing changes through to the database.
 *
 * Called once, after `loadLocal`, so the load itself is not written straight
 * back out.
 */
export function startPersistence() {
  last = useStore.getState();

  useStore.subscribe((state) => {
    const previous = last;
    last = state;
    if (!previous) return;

    for (const entry of TABLES) {
      if (entry.read(state) !== entry.read(previous)) pendingTables.add(entry.table);
    }
    for (const key of SETTINGS) {
      if (state[key as keyof State] !== previous[key as keyof State]) pendingSettings.add(key);
    }

    if (pendingTables.size || pendingSettings.size) schedule();
  });

  /*
    Write the moment the app leaves the screen.

    Changes are coalesced for a few hundred milliseconds so that typing a name
    is one write rather than one per letter. The cost is a window: a teacher who
    marks the last student and immediately switches apps can have the phone kill
    ClassCare before the timer fires, and that mark is gone. Android kills
    backgrounded apps freely on the hardware these teachers actually have, so
    this is not a rare case.

    Flushing on the way out closes it. `inactive` is included for iOS, which
    passes through it during the app switcher.
  */
  AppState.addEventListener('change', (status) => {
    if (status === 'background' || status === 'inactive') void flush();
  });
}

/**
 * Forget this account's data on this device.
 *
 * Both halves matter: the tables, and the in-flight write that would otherwise
 * put the old teacher's students back a moment later.
 */
export async function wipeLocal(): Promise<void> {
  pendingTables = new Set();
  pendingSettings = new Set();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await writing.catch(() => {});
  await clearLocalData();
  last = useStore.getState();
}
