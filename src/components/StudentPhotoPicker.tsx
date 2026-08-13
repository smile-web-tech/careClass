/**
 * The picture at the top of a student's form.
 *
 * A face is the fastest way to tell one Aýgül from another, and a teacher with
 * four groups of twenty knows the faces long before they know the names on
 * paper. Tapping offers the camera or the gallery; tapping an existing one
 * offers to replace or remove it.
 *
 * The work of shrinking and storing is in `lib/studentPhoto`. This is only the
 * control, and everything it can go wrong with is said in words the teacher can
 * act on: a refused permission points at Settings, a failed camera says the
 * camera failed rather than showing a spinner that never stops.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { showAlert, showDialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { describeError } from '@/lib/errors';
import {
  capturePhoto,
  deletePhoto,
  photoUri,
  requestPhotoPermission,
  type PhotoSource,
} from '@/lib/studentPhoto';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

export function StudentPhotoPicker({
  studentId,
  name,
  onChanged,
}: {
  /** The id the file is stored under. Minted before the form is saved. */
  studentId: string;
  /** For the initials shown until there is a picture. */
  name: string;
  /** Fired after a change so the form can mark itself dirty. */
  onChanged?: (hasPhoto: boolean) => void;
}) {
  const t = useT();
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);

  /*
    The URI is held in state with a cache-busting suffix rather than read on
    every render. `expo-image` caches by URI, and the path never changes when a
    photo is replaced — so without this the teacher retakes a picture and the
    old one stays on screen.
  */
  const [uri, setUri] = useState<string | null>(() => photoUri(studentId));
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  const take = async (source: PhotoSource) => {
    setBusy(true);
    try {
      const granted = await requestPhotoPermission(source);
      if (!granted) {
        await showAlert(
          t('photo.permissionTitle'),
          source === 'camera' ? t('photo.cameraDenied') : t('photo.libraryDenied'),
          'danger',
        );
        return;
      }

      const saved = await capturePhoto(studentId, source);
      if (!saved) return; // Backed out of the camera. Nothing to say.

      setUri(saved);
      setVersion((v) => v + 1);
      onChanged?.(true);
    } catch (e) {
      const described = describeError(e);
      await showAlert(t('photo.failedTitle'), described.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    deletePhoto(studentId);
    setUri(null);
    setVersion((v) => v + 1);
    onChanged?.(false);
  };

  const open = async () => {
    if (busy) return;

    const choice = await showDialog({
      title: t('photo.title'),
      tone: 'info',
      actions: [
        { label: t('photo.takePhoto'), value: 'camera', intent: 'primary' },
        { label: t('photo.choosePhoto'), value: 'library', intent: 'primary' },
        ...(uri ? [{ label: t('photo.remove'), value: 'remove', intent: 'danger' as const }] : []),
        { label: t('common.cancel'), value: 'cancel', intent: 'quiet' as const },
      ],
    });

    if (choice === 'camera' || choice === 'library') await take(choice);
    else if (choice === 'remove') remove();
  };

  const initials =
    name
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <View style={styles.wrap}>
      <Press onPress={() => void open()} accessibilityLabel={t('photo.title')}>
        <View style={styles.frame}>
          {busy ? (
            <ActivityIndicator color={color.primary} />
          ) : uri ? (
            <Image
              source={{ uri: `${uri}?v=${version}` }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="none"
            />
          ) : (
            <Text style={styles.initials}>{initials}</Text>
          )}

          <View style={[styles.badge, { backgroundColor: color.primary }]}>
            <Icon name={uri ? 'pencil' : 'plus'} size={12} color="#ffffff" />
          </View>
        </View>
      </Press>

      <Text style={styles.hint}>{uri ? t('photo.change') : t('photo.add')}</Text>
    </View>
  );
}

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', marginBottom: 18 },
    frame: {
      width: 92,
      height: 92,
      borderRadius: radius.hero,
      backgroundColor: color.fill,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    image: { width: 92, height: 92, borderRadius: radius.hero },
    initials: { fontFamily: body[700], fontSize: 28, color: color.mutedLight },
    badge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: color.sheet,
    },
    hint: { fontFamily: body[600], fontSize: 12.5, color: color.mutedLight, marginTop: 9 },
  });
