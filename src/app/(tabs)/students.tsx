import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, useTabInset } from '@/components/layout';
import { Avatar, EmptyState, IconButton, Press } from '@/components/ui';
import { useGroups, useStudents } from '@/data/store';
import type { Student } from '@/data/types';
import { callNumber, smsNumber } from '@/lib/contact';
import { radius, space, useTheme, useThemedStyles, type AccentName, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

/**
 * The full address book. Not one of the nine mockups, but the tab bar in the
 * design points here — so it follows the same list vocabulary as the group
 * roster, with an A–Z grouping since this list is long.
 */
export default function Students() {
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const bottomInset = useTabInset(24);
  const router = useRouter();

  const students = useStudents();
  const groups = useGroups();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? students.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
        )
      : students;

    const buckets = new Map<string, Student[]>();
    for (const s of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
      const letter = s.name[0]?.toUpperCase() ?? '#';
      const list = buckets.get(letter) ?? [];
      list.push(s);
      buckets.set(letter, list);
    }
    return [...buckets.entries()].map(([title, data]) => ({ title, data }));
  }, [query, students]);

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[text.pageTitle, styles.ink]}>Students</Text>
            <Text style={styles.count}>
              {students.length} across {groups.length} groups
            </Text>
          </View>
          <IconButton
            name="check"
            iconSize={18}
            fg={color.inkSoft}
            accessibilityLabel="Grades"
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
            placeholder="Search by name or number"
            placeholderTextColor={color.mutedLight}
            style={styles.searchInput}
            autoCorrect={false}
            clearButtonMode="while-editing"
            selectionColor={color.primary}
            keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
          />
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 14,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<EmptyState title="No students" hint="Try another name or number" />}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionLetter}>{section.title}</Text>
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
    </Screen>
  );
}

function StudentRow({
  student,
  groupNames,
  onPress,
}: {
  student: Student;
  groupNames: { name: string; accent: AccentName }[];
  onPress: () => void;
}) {
  const { accents, color, status } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Press onPress={onPress} style={styles.row}>
      <Avatar name={student.name} accent={student.accent} size={42} radius={radius.button} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[text.rowTitleSm, styles.ink]} numberOfLines={1}>
          {student.name}
        </Text>
        <View style={styles.tagRow}>
          {groupNames.length ? (
            groupNames.map((g) => (
              <View key={g.name} style={[styles.tag, { backgroundColor: accents[g.accent].tint }]}>
                <Text style={[styles.tagLabel, { color: accents[g.accent].inkDeep }]}>
                  {g.name}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.noGroup}>No group</Text>
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

    sectionLetter: {
      fontFamily: body[700],
      fontSize: 11.5,
      letterSpacing: 1.38,
      color: color.mutedLight,
      marginTop: 14,
      marginBottom: 8,
      marginLeft: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderRadius: radius.tile,
      paddingVertical: 11,
      paddingLeft: 13,
      paddingRight: 12,
      marginBottom: 8,
    },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
    tag: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: radius.xs + 1,
    },
    tagLabel: { fontFamily: body[600], fontSize: 10.5 },
    noGroup: { fontFamily: body[400], fontSize: 12.5, color: color.mutedLight },
  });
