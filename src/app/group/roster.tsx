/**
 * Choose which students are in a group.
 *
 * The "Add" link on a group used to go straight to the new-student form, which
 * was wrong twice over: a teacher who has already entered their students had no
 * way to put an existing one into a second group, and the only path on offer
 * invited them to type the same person in again as a duplicate.
 *
 * So this is a picker over the students that already exist, with the current
 * roster pre-ticked. Unticking removes, which makes it the one screen that owns
 * membership rather than splitting add and remove across two places. Creating
 * someone genuinely new is still one tap away at the bottom.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import { useT } from '@/i18n/useT';
import { Avatar, Button, EmptyState, Press } from '@/components/ui';
import { useGroup, useStore, useStudents } from '@/data/store';
import type { Student } from '@/data/types';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body, text } from '@/theme/type';

export default function GroupRoster() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { color, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const group = useGroup(id);
  const students = useStudents();
  const setGroupRoster = useStore((s) => s.setGroupRoster);

  const [query, setQuery] = useState('');
  // Seeded once from the current roster and edited freely; nothing is written
  // until Save, so backing out changes nothing.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(students.filter((s) => s.groupIds.includes(id)).map((s) => s.id)),
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? students.filter(
          (s) => s.name.toLowerCase().includes(q) || s.phone.replace(/\s/g, '').includes(q),
        )
      : students;
    // Members first, so the teacher can see who is already in without hunting.
    return [...list].sort((a, b) => {
      const am = picked.has(a.id) ? 0 : 1;
      const bm = picked.has(b.id) ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
  }, [students, query, picked]);

  if (!group) {
    return (
      <Screen>
        <TopBar title={t('nav.students')} dismiss />
        <EmptyState title={t('groups.gone')} hint={t('common.goBack')} />
      </Screen>
    );
  }

  const toggle = (studentId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(studentId) ? next.delete(studentId) : next.add(studentId);
      return next;
    });

  const save = () => {
    setGroupRoster(group.id, [...picked]);
    router.back();
  };

  const added = [...picked].filter(
    (sid) => !students.find((s) => s.id === sid)?.groupIds.includes(group.id),
  ).length;
  const removed = students.filter((s) => s.groupIds.includes(group.id) && !picked.has(s.id)).length;
  const dirty = added > 0 || removed > 0;

  return (
    <Screen>
      <TopBar title={group.name} dismiss />

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

      <FlatList
        data={shown}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 6,
          paddingBottom: insets.bottom + 150,
        }}
        ListEmptyComponent={
          <EmptyState
            title={t(students.length === 0 ? 'students.noneYet' : 'students.nobodyMatches')}
            hint={
              students.length === 0
                ? t('students.addFirst')
                : t('students.tryAnother')
            }
          />
        }
        renderItem={({ item }) => (
          <PickRow student={item} checked={picked.has(item.id)} onPress={() => toggle(item.id)} />
        )}
        ListFooterComponent={
          <Press
            onPress={() => router.push({ pathname: '/student/new', params: { group: group.id } })}
            style={styles.newRow}>
            <View style={styles.newIcon}>
              <Icon name="plus" size={15} color={color.primary} strokeWidth={2} />
            </View>
            <Text style={styles.newLabel}>{t('students.new')}</Text>
          </Press>
        }
      />

      <StickyFooter>
        <Button
          grow
          height={50}
          label={
            dirty
              ? [added ? `Add ${added}` : null, removed ? `remove ${removed}` : null]
                  .filter(Boolean)
                  .join(' · ')
              : 'Done'
          }
          onPress={save}
        />
      </StickyFooter>
    </Screen>
  );
}

function PickRow({
  student,
  checked,
  onPress,
}: {
  student: Student;
  checked: boolean;
  onPress: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Press
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={student.name}
      style={[styles.row, checked && styles.rowOn]}>
      <Avatar name={student.name} accent={student.accent} size={40} radius={radius.button} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[text.rowTitleSm, styles.ink]} numberOfLines={1}>
          {student.name}
        </Text>
        <Text style={styles.phone}>{student.phone}</Text>
      </View>

      <View
        style={[
          styles.check,
          checked && { backgroundColor: color.primary, borderColor: color.primary },
        ]}>
        {checked ? <Icon name="check" size={13} color="#fff" strokeWidth={2.6} /> : null}
      </View>
    </Press>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    ink: { color: color.ink },

    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      marginHorizontal: space.gutter,
      marginBottom: 12,
      paddingHorizontal: 13,
      height: 46,
      borderRadius: radius.field,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    searchInput: { flex: 1, fontFamily: body[500], fontSize: 14.5, color: color.ink },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      borderRadius: radius.tile,
      paddingVertical: 10,
      paddingLeft: 12,
      paddingRight: 13,
      marginBottom: 8,
    },
    rowOn: { borderColor: color.primary, backgroundColor: color.primaryTint },
    phone: { fontFamily: body[400], fontSize: 12.5, color: color.muted, marginTop: 3 },

    check: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },

    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      marginTop: 4,
    },
    newIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.button,
      backgroundColor: color.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newLabel: { fontFamily: body[700], fontSize: 14.5, color: color.primary },
  });
