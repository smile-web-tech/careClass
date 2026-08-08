import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { confirm } from '@/components/Dialog';
import { useT } from '@/i18n/useT';
import { GroupForm } from '@/components/GroupForm';
import { Icon } from '@/components/Icon';
import { Card, Press } from '@/components/ui';
import { useStore, useStudents } from '@/data/store';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

/**
 * Edit an existing group. Everything set at creation can be changed here —
 * name, subject, room, days, times and colour — plus deletion.
 */
export default function EditGroup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const group = useStore((s) => s.groups.find((g) => g.id === id));
  const students = useStudents();
  const updateGroup = useStore((s) => s.updateGroup);
  const removeGroup = useStore((s) => s.removeGroup);

  const memberCount = students.filter((s) => group && s.groupIds.includes(group.id)).length;

  if (!group) {
    return (
      <GroupForm
        title={t('groups.edit')}
        submitLabel={t('common.save')}
        onSubmit={() => router.back()}
      />
    );
  }

  /**
   * Two-step, because it cannot be undone. The server cascades through
   * `group_slots`, `student_groups` and `attendance`, so the schedule and the
   * whole attendance history for this group go with it. Students survive.
   */
  const confirmDelete = async () => {
    const first = await confirm({
      title: t('groups.deleteTitle', { name: group.name }),
      message: memberCount
        ? t('groups.deleteMessageWithStudents', { count: memberCount })
        : t('groups.deleteMessage'),
      confirmLabel: t('groups.deleteConfirm'),
    });
    if (!first) return;

    const sure = await confirm({
      title: t('groups.areYouSure'),
      message: t('groups.noUndo'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('groups.keepIt'),
    });
    if (!sure) return;

    removeGroup(group.id);
    router.replace('/(tabs)');
  };

  return (
    <GroupForm
      title={t('groups.edit')}
      submitLabel={t('common.saveChanges')}
      initial={group}
      footer={<DangerZone onDelete={confirmDelete} />}
      onSubmit={(draft) => {
        updateGroup(group.id, draft);
        router.back();
      }}
    />
  );
}

function DangerZone({ onDelete }: { onDelete: () => void }) {
  const { color, status } = useTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <Press onPress={onDelete} style={styles.row} accessibilityRole="button">
          <View style={[styles.icon, { backgroundColor: status.absent.tint }]}>
            <Icon name="close" size={15} color={color.dangerDeep} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.label, { color: color.dangerDeep }]}>
              {t('groups.deleteThis')}
            </Text>
            <Text style={styles.hint} numberOfLines={2}>
              {t('groups.deleteHint')}
            </Text>
          </View>
          <Icon name="disclosure" size={16} color={color.chevron} />
        </Press>
      </Card>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    wrap: { marginTop: 14 },
    card: { overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    icon: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: { fontFamily: body[700], fontSize: 14.5 },
    hint: { fontFamily: body[400], fontSize: 12, color: color.mutedLight, marginTop: 2 },
  });
