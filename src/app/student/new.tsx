import * as Contacts from 'expo-contacts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Screen, StickyFooter, TopBar } from '@/components/layout';
import {
  Button,
  Card,
  Divider,
  FieldRow,
  Overline,
  Press,
  SelectChip,
  Toggle,
} from '@/components/ui';
import { useGroups, useStore } from '@/data/store';
import { smsNumber } from '@/lib/contact';
import { slotDaysLabel, slotTimeLabel } from '@/lib/schedule';
import { radius, space, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const blank = {
  name: '',
  phone: '',
  email: '',
  parentName: '',
  parentPhone: '',
};

export default function NewStudent() {
  const { accents, color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ group?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const groups = useGroups();
  const addStudent = useStore((s) => s.addStudent);

  const [form, setForm] = useState(blank);
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    params.group ? { [params.group]: true } : {},
  );
  const [welcome, setWelcome] = useState(true);

  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const ready = form.name.trim().length > 1 && form.phone.trim().length > 5;
  const groupIds = groups.filter((g) => picked[g.id]).map((g) => g.id);

  const importFromContacts = async () => {
    const { granted } = await Contacts.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Contacts access needed',
        'Allow ClassCare to read contacts so you can pull a student’s details in without retyping them.',
      );
      return;
    }

    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return;

    setForm((f) => ({
      ...f,
      name: contact.name ?? f.name,
      phone: contact.phoneNumbers?.[0]?.number?.trim() ?? f.phone,
      email: contact.emails?.[0]?.email ?? f.email,
    }));
  };

  const commit = () => {
    const id = addStudent({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      parentName: form.parentName.trim() || undefined,
      parentPhone: form.parentPhone.trim() || undefined,
      groupIds,
    });

    if (welcome) {
      const names = groups.filter((g) => picked[g.id]);
      const schedule = names
        .map((g) => `${g.name}: ${slotDaysLabel(g)} ${slotTimeLabel(g)}, ${g.room}`)
        .join('. ');
      // Opens the native composer pre-filled — the OS never lets an app send
      // an SMS silently, so the teacher taps send.
      smsNumber(
        form.phone.trim(),
        `Welcome to ClassCare, ${form.name.trim().split(' ')[0]}! ${
          schedule || 'Your schedule follows shortly.'
        } — ${useStore.getState().teacherName}`,
      );
    }

    return id;
  };

  const save = () => {
    commit();
    router.back();
  };

  const saveAndAdd = () => {
    commit();
    setForm(blank);
  };

  return (
    <Screen>
      <TopBar title="New student" dismiss />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}>
        <ScrollView
          contentContainerStyle={{
            padding: space.gutter,
            paddingBottom: insets.bottom + 140,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Press onPress={importFromContacts}>
            <Card style={styles.importCard}>
              <View style={styles.importIcon}>
                <Icon name="contacts" size={19} color={color.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>Import from contacts</Text>
                <Text style={styles.importHint}>Fill the form from your address book</Text>
              </View>
              <Icon name="disclosure" size={16} color={color.chevron} />
            </Card>
          </Press>

          <Overline style={styles.label}>Student</Overline>
          <Card style={styles.group}>
            <FieldRow
              label="Name"
              placeholder="Full name"
              value={form.name}
              onChangeText={set('name')}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Divider inset={15} />
            <FieldRow
              label="Phone"
              placeholder="+998 90 000 00 00"
              value={form.phone}
              onChangeText={set('phone')}
              keyboardType="phone-pad"
            />
            <Divider inset={15} />
            <FieldRow
              label="Email"
              placeholder="Optional"
              value={form.email}
              onChangeText={set('email')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Card>

          <Overline style={styles.label}>Parent / guardian</Overline>
          <Card style={styles.group}>
            <FieldRow
              label="Name"
              placeholder="Optional"
              value={form.parentName}
              onChangeText={set('parentName')}
              autoCapitalize="words"
            />
            <Divider inset={15} />
            <FieldRow
              label="Phone"
              placeholder="+998 90 000 00 00"
              value={form.parentPhone}
              onChangeText={set('parentPhone')}
              keyboardType="phone-pad"
            />
          </Card>

          <Overline style={styles.label}>Add to groups</Overline>
          <View style={styles.chipWrap}>
            {groups.map((g) => (
              <SelectChip
                key={g.id}
                label={g.name}
                dot={accents[g.accent].dot}
                height={42}
                selected={!!picked[g.id]}
                onPress={() => setPicked((p) => ({ ...p, [g.id]: !p[g.id] }))}
              />
            ))}
          </View>

          <Card style={styles.welcomeCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.welcomeTitle}>Send welcome SMS</Text>
              <Text style={styles.welcomeHint}>Schedule and your contact details</Text>
            </View>
            <Toggle value={welcome} onChange={setWelcome} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <StickyFooter style={{ gap: 10 }}>
        <Press onPress={saveAndAdd} disabled={!ready} style={styles.secondarySave}>
          <Text style={styles.secondarySaveLabel}>Save & add another</Text>
        </Press>
        <Button grow label="Save" height={50} onPress={save} disabled={!ready} />
      </StickyFooter>
    </Screen>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    label: { marginBottom: 10 },

    importCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 15,
      paddingVertical: 13,
      marginBottom: 22,
    },
    importIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.button,
      backgroundColor: color.primaryTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    importTitle: { fontFamily: body[700], fontSize: 14.5, color: color.ink },
    importHint: {
      fontFamily: body[400],
      fontSize: 12.5,
      color: color.mutedLight,
      marginTop: 2,
    },

    group: { overflow: 'hidden', marginBottom: 22 },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 22,
    },

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

    secondarySave: {
      height: 50,
      paddingHorizontal: 20,
      borderRadius: radius.button,
      backgroundColor: color.fill,
      borderWidth: 1,
      borderColor: color.border,
      justifyContent: 'center',
    },
    secondarySaveLabel: {
      fontFamily: body[600],
      fontSize: 14.5,
      color: color.inkSoft,
    },
  });
