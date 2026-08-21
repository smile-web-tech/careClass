import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlphabetIndex } from '@/components/AlphabetIndex';
import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import { Avatar, EmptyState, IconButton, Press, SelectChip } from '@/components/ui';
import { useGroups, useStudents } from '@/data/store';
import { refreshAll } from '@/data/sync';
import type { Gender, Student } from '@/data/types';
import { useT } from '@/i18n/useT';
import type { TranslationKey } from '@/i18n';
import { callNumber, smsNumber } from '@/lib/contact';
import { ageFrom, toKey } from '@/lib/date';
import { exportStudentsSheet, importStudentsSheet } from '@/lib/sheetFlow';
import { compareTerms, termLabel, termOf } from '@/lib/term';
import { radius, space, useTheme, useThemedStyles, type AccentName, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

/**
 * The full address book.
 *
 * Long lists are the point of this screen: a tutor with sixty students cannot
 * find one by scrolling, so everything here is about narrowing. Search on the
 * text, filters on the facts, a letter rail for the last few centimetres.
 *
 * ## Row and header heights are constants, deliberately
 *
 * `scrollToLocation` — what the rail calls — has to know where a section starts
 * before it has been rendered. Without `getItemLayout` it guesses from whatever
 * has been measured so far and lands in the wrong place on a list this long.
 * So the row height is fixed and the group tags are capped at two with a "+3"
 * for the rest, which is also the reason the rows stay a tidy grid rather than
 * growing a line whenever a child joins a fourth group.
 */

/** Row box: 42 avatar, 11 padding each side, 1 border each side, 8 gap below. */
const ROW_H = 74;
/** Section letter: 14 above, ~14 of text, 8 below. */
const HEADER_H = 36;
/** `contentContainerStyle.paddingTop`, above the first header. */
const LIST_TOP = 14;
/** Group tags on a row before the rest become a count. */
const TAGS_SHOWN = 2;

type GenderFilter = 'any' | Gender | 'none';
type SortMode = 'name' | 'place';

/**
 * Age bands rather than a slider.
 *
 * A tutor thinks in school stages — the little ones, the exam years — not in
 * "students aged 11 to 14". Bands make the common questions one tap, and a
 * slider would make every one of them a fiddle.
 */
const AGE_BANDS = [
  { key: 'under10', labelKey: 'students.ageUnder' as TranslationKey, params: { age: 10 }, min: 0, max: 9 },
  { key: '10to13', labelKey: 'students.ageBetween' as TranslationKey, params: { from: 10, to: 13 }, min: 10, max: 13 },
  { key: '14to17', labelKey: 'students.ageBetween' as TranslationKey, params: { from: 14, to: 17 }, min: 14, max: 17 },
  { key: '18plus', labelKey: 'students.ageOver' as TranslationKey, params: { age: 18 }, min: 18, max: 200 },
] as const;

type AgeBand = (typeof AGE_BANDS)[number]['key'] | 'any';

export default function Students() {
  const t = useT();
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(24);
  const router = useRouter();

  const students = useStudents();
  const groups = useGroups();
  const [query, setQuery] = useState('');

  const [gender, setGender] = useState<GenderFilter>('any');
  const [term, setTerm] = useState<string>('any');
  const [age, setAge] = useState<AgeBand>('any');
  const [sort, setSort] = useState<SortMode>('name');
  const [showFilters, setShowFilters] = useState(false);

  const listRef = useRef<SectionList<Student, Section>>(null);

  const activeCount =
    (gender === 'any' ? 0 : 1) + (term === 'any' ? 0 : 1) + (age === 'any' ? 0 : 1);

  const clearFilters = () => {
    setGender('any');
    setTerm('any');
    setAge('any');
    setSort('name');
  };

  /*
    Pull down to pull the account down.

    Only the inbox had this, so a teacher who suspected the list was out of date
    — a student added on another phone, a face that had not come through — had
    no way to ask for a fresh copy short of killing the app. `hydrate` also
    fetches any pictures this device is missing, which is the half of it people
    actually notice.
  */
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      // Offline, or the proxy is down. The list keeps what it had; an alert
      // would fire on every pull made on a bad connection, which is most of
      // them here.
    } finally {
      setRefreshing(false);
    }
  }, []);

  /*
    A group's term, falling back to the one its start date implies.

    Only groups created or edited since terms existed carry one, and a teacher
    who has been using this app for a year would otherwise open the filter to
    find no terms at all — every course they have ever run invisible to it until
    they went through and re-saved each one. The start date already says which
    season a course belongs to; `termOf` is the same reading of it the group
    form offers as its default, so the filter and the form agree.

    Derived on read rather than written back: a stored term is the teacher's
    answer and a derived one is a guess, and quietly turning the second into the
    first would overwrite a deliberate choice on the next sync.
  */
  const thisTerm = useMemo(() => termOf(toKey(new Date())), []);

  const termFor = useCallback(
    (g: { term?: string; startsOn?: string }) =>
      // A group with neither is one that predates dates entirely, and a group
      // with no first and no last day is by definition still running — so the
      // term it belongs to is this one. Without this last step a teacher whose
      // groups all predate migration 0016 opens the filter to an empty row,
      // which is the bug this whole fallback exists to prevent.
      g.term ?? (g.startsOn ? termOf(g.startsOn) : thisTerm),
    [thisTerm],
  );

  /** Terms the teacher actually has, newest first. No term, no chip. */
  const terms = useMemo(() => {
    const seen = new Set<string>();
    for (const g of groups) {
      const key = termFor(g);
      if (key) seen.add(key);
    }
    return [...seen].sort((a, b) => compareTerms(b, a));
  }, [groups, termFor]);

  /** Which terms each student belongs to, through their groups. */
  const termsByStudent = useMemo(() => {
    const groupTerm = new Map(groups.map((g) => [g.id, termFor(g)]));
    const out = new Map<string, Set<string>>();
    for (const s of students) {
      const set = new Set<string>();
      for (const id of s.groupIds) {
        const gt = groupTerm.get(id);
        if (gt) set.add(gt);
      }
      out.set(s.id, set);
    }
    return out;
  }, [students, groups, termFor]);

  const sections = useMemo(
    () =>
      buildSections({
        students,
        query,
        gender,
        term,
        age,
        sort,
        termsByStudent,
        noPlace: t('students.noPlace'),
      }),
    [students, query, gender, term, age, sort, termsByStudent, t],
  );

  /** Where every cell sits, so the rail can jump to one that has never rendered. */
  const layout = useMemo(() => offsetsFor(sections), [sections]);

  const letters = useMemo(() => {
    const out: string[] = [];
    for (const s of sections) {
      const first = s.title[0]?.toUpperCase() ?? '#';
      if (out[out.length - 1] !== first) out.push(first);
    }
    return out;
  }, [sections]);

  const jumpTo = useCallback(
    (letterIndex: number) => {
      const letter = letters[letterIndex];
      const sectionIndex = sections.findIndex((s) => (s.title[0]?.toUpperCase() ?? '#') === letter);
      if (sectionIndex < 0) return;
      listRef.current?.scrollToLocation({
        sectionIndex,
        // Cell 0 of a section is its *header*, not its first row —
        // `VirtualizedSectionList` reserves a header and a footer slot for
        // every section, and `scrollToLocation` counts both. So this already
        // lands on the letter, and the only offset wanted is a little air
        // above it.
        itemIndex: 0,
        viewOffset: 6,
        animated: false,
      });
    },
    [letters, sections],
  );

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[text.pageTitle, styles.ink]}>{t('nav.students')}</Text>
            <Text style={styles.count}>
              {t('students.acrossGroups', { count: students.length, groups: groups.length })}
            </Text>
          </View>
          <IconButton
            name="check"
            iconSize={18}
            fg={color.inkSoft}
            accessibilityLabel={t('nav.grades')}
            onPress={() => router.push('/grades')}
            style={{ marginRight: 8 }}
          />
          <IconButton
            name="plusLarge"
            iconSize={19}
            tint={color.primary}
            fg="#fff"
            onPress={() => router.push('/student/new')}
          />
        </View>

        <View style={styles.search}>
          <Icon name="search" size={17} color={color.mutedLight} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('students.searchPlaceholder')}
            placeholderTextColor={color.mutedLight}
            style={styles.searchInput}
            autoCorrect={false}
            clearButtonMode="while-editing"
            selectionColor={color.primary}
            keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
          />
        </View>

        {/*
          One button, not a permanent wall of chips.

          Filters are a rare gesture and the search field is a daily one; four
          rows of options sitting open above the list would push the students
          themselves off the screen every time somebody opened this tab. The
          count on the button is what stops a filter being left on by accident
          and read as an empty address book.
        */}
        <View style={styles.filterBar}>
          <Press
            haptic
            onPress={() => setShowFilters((v) => !v)}
            style={[styles.filterButton, activeCount > 0 && styles.filterButtonOn]}>
            <Icon
              name="sliders"
              size={15}
              color={activeCount > 0 ? color.primaryInk : color.inkSoft}
            />
            <Text style={[styles.filterLabel, activeCount > 0 && { color: color.primaryInk }]}>
              {activeCount > 0
                ? t('students.filterCount', { count: activeCount })
                : t('students.filters')}
            </Text>
          </Press>
          {activeCount > 0 || sort !== 'name' ? (
            <Press haptic onPress={clearFilters} style={styles.clearButton}>
              <Text style={styles.clearLabel}>{t('students.clearFilters')}</Text>
            </Press>
          ) : null}
        </View>
      </View>

      {showFilters ? (
        <View style={styles.panel}>
          <FilterRow label={t('student.gender')}>
            <SelectChip
              height={32}
              label={t('students.anyGender')}
              selected={gender === 'any'}
              onPress={() => setGender('any')}
            />
            <SelectChip
              height={32}
              label={t('students.female')}
              selected={gender === 'female'}
              onPress={() => setGender('female')}
            />
            <SelectChip
              height={32}
              label={t('students.male')}
              selected={gender === 'male'}
              onPress={() => setGender('male')}
            />
            <SelectChip
              height={32}
              label={t('students.notRecorded')}
              selected={gender === 'none'}
              onPress={() => setGender('none')}
            />
          </FilterRow>

          {terms.length ? (
            <FilterRow label={t('groups.term')}>
              <SelectChip
                height={32}
                label={t('students.anyTerm')}
                selected={term === 'any'}
                onPress={() => setTerm('any')}
              />
              {terms.map((key) => (
                <SelectChip
                  key={key}
                  height={32}
                  label={termLabel(key, t)}
                  selected={term === key}
                  onPress={() => setTerm(key)}
                />
              ))}
            </FilterRow>
          ) : null}

          <FilterRow label={t('students.age')}>
            <SelectChip
              height={32}
              label={t('students.anyAge')}
              selected={age === 'any'}
              onPress={() => setAge('any')}
            />
            {AGE_BANDS.map((b) => (
              <SelectChip
                key={b.key}
                height={32}
                label={t(b.labelKey, b.params)}
                selected={age === b.key}
                onPress={() => setAge(b.key)}
              />
            ))}
          </FilterRow>

          <FilterRow label={t('students.sortBy')}>
            <SelectChip
              height={32}
              label={t('students.sortName')}
              selected={sort === 'name'}
              onPress={() => setSort('name')}
            />
            <SelectChip
              height={32}
              label={t('students.sortPlace')}
              selected={sort === 'place'}
              onPress={() => setSort('place')}
            />
          </FilterRow>
        </View>
      ) : null}

      {/*
        Under the search, not in the header.

        The header bar is where "add one student" lives, and a spreadsheet is
        the opposite gesture — a rare, deliberate, whole-list action. Putting it
        in the same row would crowd the one button teachers press every day.
      */}
      <View style={styles.sheetRow}>
        <Press onPress={() => void importStudentsSheet()} style={styles.sheetButton}>
          <Icon name="paperclip" size={15} color={color.primary} />
          <Text style={styles.sheetLabel}>{t('csv.import')}</Text>
        </Press>
        <Press onPress={() => void exportStudentsSheet()} style={styles.sheetButton}>
          <Icon name="send" size={15} color={color.primary} />
          <Text style={styles.sheetLabel}>{t('csv.export')}</Text>
        </Press>
      </View>

      <View style={{ flex: 1 }}>
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(s) => s.id}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          getItemLayout={layout}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingTop: LIST_TOP,
            paddingBottom: bottomInset,
          }}
          // The rail needs somewhere to live that is not on top of a row's
          // call button, and the letters are legible against the gutter.
          style={{ paddingRight: 18 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={color.muted}
              colors={[color.primary]}
              progressBackgroundColor={color.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={activeCount > 0 ? t('students.noneMatch') : t('students.noMatches')}
              hint={t('students.tryAnother')}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionLetter} numberOfLines={1}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <StudentRow
              student={item}
              groupNames={groups
                .filter((g) => item.groupIds.includes(g.id))
                .map((g) => ({ name: g.name, accent: g.accent }))}
              onPress={() => router.push(`/student/${item.id}`)}
            />
          )}
        />

        <AlphabetIndex letters={letters} onPick={jumpTo} />
      </View>
    </Screen>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterRowLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filterChips}>
        {children}
      </ScrollView>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Filtering, sorting, sectioning                                             */
/* -------------------------------------------------------------------------- */

type Section = { title: string; data: Student[] };

/**
 * Where a student lives, as a heading.
 *
 * The first comma-separated part of the address, which is how people write
 * these — "Aşgabat, Görogly köçesi 12" is a city and a street, and the city is
 * the useful bucket. An address with no comma is its own heading, which for a
 * tutor whose students all live in one town is exactly right: the streets
 * become the groups.
 */
const placeOf = (s: Student) => (s.address ?? '').split(',')[0]?.trim() ?? '';

function buildSections({
  students,
  query,
  gender,
  term,
  age,
  sort,
  termsByStudent,
  noPlace,
}: {
  students: Student[];
  query: string;
  gender: GenderFilter;
  term: string;
  age: AgeBand;
  sort: SortMode;
  termsByStudent: Map<string, Set<string>>;
  noPlace: string;
}): Section[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\s/g, '');
  const band = AGE_BANDS.find((b) => b.key === age);

  const matches = students.filter((s) => {
    if (q) {
      const hit =
        s.name.toLowerCase().includes(q) ||
        s.phone.replace(/\s/g, '').includes(digits) ||
        (s.address ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }

    // "Not recorded" is its own answer, not a third gender: it selects the
    // students whose gender nobody has filled in, which is the list a teacher
    // wants when they are trying to finish filling it in.
    if (gender === 'none' ? !!s.gender : gender !== 'any' && s.gender !== gender) return false;

    if (term !== 'any' && !termsByStudent.get(s.id)?.has(term)) return false;

    if (band) {
      // No birth date means no age, and a student with no age cannot be in a
      // band. Silently including them would put ten-year-olds in the 18+ list.
      if (!s.birthDate) return false;
      const years = ageFrom(s.birthDate);
      if (years < band.min || years > band.max) return false;
    }

    return true;
  });

  const buckets = new Map<string, Student[]>();

  if (sort === 'place') {
    const sorted = [...matches].sort(
      (a, b) => placeOf(a).localeCompare(placeOf(b)) || a.name.localeCompare(b.name),
    );
    for (const s of sorted) {
      // Students with no address collect under one heading at the end rather
      // than under "#", so the teacher can see at a glance how many are missing
      // one — which is usually why they sorted by place in the first place.
      const key = placeOf(s) || noPlace;
      const list = buckets.get(key) ?? [];
      list.push(s);
      buckets.set(key, list);
    }
    const entries = [...buckets.entries()];
    const named = entries.filter(([k]) => k !== noPlace);
    const missing = entries.filter(([k]) => k === noPlace);
    return [...named, ...missing].map(([title, data]) => ({ title, data }));
  }

  for (const s of [...matches].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = s.name[0]?.toUpperCase() ?? '#';
    const list = buckets.get(letter) ?? [];
    list.push(s);
    buckets.set(letter, list);
  }
  return [...buckets.entries()].map(([title, data]) => ({ title, data }));
}

/**
 * A `getItemLayout` for the section list, from constant row and header heights.
 *
 * `SectionList` reserves a header *and* a footer cell for every section whether
 * or not either is rendered, so the flattened index this is called with counts
 * both. The footer is given zero height because nothing is drawn in it —
 * getting that wrong shifts every section below it by a row.
 *
 * Offsets are computed once per list rather than walked on each call: this is
 * asked for every cell, and the walk would make rendering quadratic in a list
 * whose whole problem is that it is long.
 */
function offsetsFor(sections: Section[]) {
  const offsets: number[] = [];
  const heights: number[] = [];
  let offset = LIST_TOP;

  for (const section of sections) {
    offsets.push(offset);
    heights.push(HEADER_H);
    offset += HEADER_H;

    for (let i = 0; i < section.data.length; i += 1) {
      offsets.push(offset);
      heights.push(ROW_H);
      offset += ROW_H;
    }

    offsets.push(offset);
    heights.push(0);
  }

  return (_data: unknown, index: number) => ({
    length: heights[index] ?? 0,
    offset: offsets[index] ?? offset,
    index,
  });
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function StudentRow({
  student,
  groupNames,
  onPress,
}: {
  student: Student;
  groupNames: { name: string; accent: AccentName }[];
  onPress: () => void;
}) {
  const t = useT();
  const { accents, color, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const shown = groupNames.slice(0, TAGS_SHOWN);
  const extra = groupNames.length - shown.length;

  return (
    <Press onPress={onPress} style={styles.row}>
      <Avatar
        name={student.name}
        accent={student.accent}
        photoId={student.id}
        size={42}
        radius={radius.button}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[text.rowTitleSm, styles.ink]} numberOfLines={1}>
          {student.name}
        </Text>
        <View style={styles.tagRow}>
          {shown.length ? (
            <>
              {shown.map((g) => (
                <View
                  key={g.name}
                  style={[styles.tag, { backgroundColor: accents[g.accent].tint }]}>
                  <Text
                    style={[styles.tagLabel, { color: accents[g.accent].inkDeep }]}
                    numberOfLines={1}>
                    {g.name}
                  </Text>
                </View>
              ))}
              {extra > 0 ? <Text style={styles.moreTag}>{`+${extra}`}</Text> : null}
            </>
          ) : (
            <Text style={styles.noGroup}>{t('messages.noGroupSelected')}</Text>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <IconButton
          name="phone"
          size={40}
          iconSize={15}
          radius={radius.control}
          tint={status.present.tint}
          fg={color.success}
          onPress={() => callNumber(student.phone)}
        />
        <IconButton
          name="chat"
          size={40}
          iconSize={15}
          radius={radius.control}
          tint={color.bg}
          fg={color.inkSoft}
          onPress={() => smsNumber(student.phone)}
        />
      </View>
    </Press>
  );
}

const makeStyles = ({ color, shadow }: Theme) =>
  StyleSheet.create({
    sheetRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: space.gutter,
      paddingTop: 12,
    },
    sheetButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 40,
      borderRadius: radius.field,
      borderWidth: 1,
      borderColor: color.border,
      backgroundColor: color.surface,
    },
    sheetLabel: { fontFamily: body[700], fontSize: 13, color: color.primaryInk },

    /** Default body ink. Text does not inherit colour from a parent View. */
    ink: { color: color.ink },
    header: {
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
      paddingHorizontal: space.gutter,
      paddingBottom: 14,
      ...shadow.card,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingBottom: 14,
    },
    count: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 3,
    },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radius.field,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      fontFamily: body[400],
      fontSize: 15,
      color: color.ink,
      padding: 0,
    },

    filterBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    filterButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      height: 34,
      paddingHorizontal: 12,
      borderRadius: radius.field,
      borderWidth: 1,
      borderColor: color.border,
      backgroundColor: color.surface,
    },
    filterButtonOn: { borderColor: color.primary, backgroundColor: color.primaryTint },
    filterLabel: { fontFamily: body[600], fontSize: 13, color: color.inkSoft },
    clearButton: { height: 34, justifyContent: 'center', paddingHorizontal: 8 },
    clearLabel: { fontFamily: body[600], fontSize: 13, color: color.primary },

    panel: {
      paddingTop: 12,
      paddingBottom: 4,
      backgroundColor: color.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border,
    },
    filterRow: { marginBottom: 10 },
    filterRowLabel: {
      fontFamily: body[700],
      fontSize: 11,
      letterSpacing: 0.66,
      textTransform: 'uppercase',
      color: color.mutedLight,
      paddingHorizontal: space.gutter,
      marginBottom: 7,
    },
    filterChips: { gap: 8, paddingHorizontal: space.gutter },

    sectionLetter: {
      fontFamily: body[700],
      fontSize: 11.5,
      letterSpacing: 1.38,
      color: color.mutedLight,
      height: HEADER_H,
      lineHeight: HEADER_H - 8,
      paddingTop: 14,
      marginLeft: 2,
    },
    row: {
      height: ROW_H - 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderRadius: radius.tile,
      paddingLeft: 13,
      paddingRight: 12,
      marginBottom: 8,
    },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
    tag: {
      maxWidth: 110,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: radius.xs + 1,
    },
    tagLabel: { fontFamily: body[600], fontSize: 10.5 },
    moreTag: { fontFamily: body[600], fontSize: 10.5, color: color.mutedLight },
    noGroup: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight },
  });
