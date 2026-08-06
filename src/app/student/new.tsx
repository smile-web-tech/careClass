import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { showAlert } from '@/components/Dialog';
import { StudentForm, type StudentDraft } from '@/components/StudentForm';
import { Card, Toggle } from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { isReachable } from '@/data/sync';
import { smsNumber } from '@/lib/contact';
import { slotDaysLabel, slotTimeLabel } from '@/lib/schedule';
import { useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export default function NewStudent() {
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ group?: string }>();
  const router = useRouter();

  const groups = useGroups();
  const addStudent = useStore((s) => s.addStudent);

  const [welcome, setWelcome] = useState(true);
  const [checking, setChecking] = useState(false);

  /**
   * Refuse to create a student the server has not heard of — same reasoning as
   * the group screen. Everything the app does afterwards refers to this student
   * by id, so one that exists only on the phone breaks messaging and attendance
   * later, at a point where nothing connects it back to a lost connection now.
   */
  const guarded = async (draft: StudentDraft, then: () => void) => {
    setChecking(true);
    const online = await isReachable();
    setChecking(false);

    if (!online) {
      await showAlert(
        'No internet',
        'A new student has to reach the server. Connect and try again.',
        'danger',
      );
      return false;
    }
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
          schedule || 'Your schedule follows shortly.'
        } — ${useStore.getState().teacherName}`,
      );
    }
  };

  return (
    <StudentForm
      title="New student"
      submitLabel={checking ? 'Checking…' : 'Save'}
      busy={checking}
      preselectGroups={params.group ? [params.group] : []}
      secondary={{ label: 'Save & add another', onPress: (draft) => guarded(draft, () => {}) }}
      extra={
        <Card style={styles.welcomeCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.welcomeTitle}>Send welcome SMS</Text>
            <Text style={styles.welcomeHint}>Schedule and your contact details</Text>
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
