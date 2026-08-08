import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { StudentForm, type StudentDraft } from '@/components/StudentForm';
import { Card, Toggle } from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { smsNumber } from '@/lib/contact';
import { slotDaysLabel, slotTimeLabel } from '@/lib/schedule';
import { useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export default function NewStudent() {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const params = useLocalSearchParams<{ group?: string }>();
  const router = useRouter();

  const groups = useGroups();
  const addStudent = useStore((s) => s.addStudent);

  const [welcome, setWelcome] = useState(true);

  /**
   * Commit the student, then do whatever the caller wanted next.
   *
   * This used to check the connection first and refuse when it was down. It no
   * longer needs to: the id is minted on the device and the write is queued to
   * disk, so a student added between lessons is real whether or not there is
   * any signal in the room.
   */
  const guarded = (draft: StudentDraft, then: () => void) => {
    commit(draft);
    then();
    return true;
  };

  const commit = (draft: StudentDraft) => {
    addStudent(draft);

    if (welcome) {
      const schedule = groups
        .filter((g) => draft.groupIds.includes(g.id))
        .map((g) => `${g.name}: ${slotDaysLabel(g)} ${slotTimeLabel(g)}, ${g.room}`)
        .join('. ');
      // Opens the native composer pre-filled — the OS never lets an app send
      // an SMS silently, so the teacher taps send.
      smsNumber(
        draft.phone,
        `Welcome to ClassCare, ${draft.name.split(' ')[0]}! ${
          schedule || t('students.welcomeSms')
        }. ${useStore.getState().teacherName}`,
      );
    }
  };

  return (
    <StudentForm
      title={t('students.new')}
      submitLabel={t('common.save')}
      preselectGroups={params.group ? [params.group] : []}
      secondary={{
        label: t('students.saveAndAddAnother'),
        onPress: (draft) => guarded(draft, () => {}),
      }}
      extra={
        <Card style={styles.welcomeCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.welcomeTitle}>{t('students.sendWelcome')}</Text>
            <Text style={styles.welcomeHint}>{t('students.sendWelcomeHint')}</Text>
          </View>
          <Toggle value={welcome} onChange={setWelcome} />
        </Card>
      }
      onSubmit={(draft) => void guarded(draft, () => router.back())}
    />
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    welcomeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    welcomeTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    welcomeHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 2,
    },
  });
