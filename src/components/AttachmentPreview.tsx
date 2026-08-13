/**
 * Looking at a file without leaving the app.
 *
 * Two places need this and they need it for the same reason. Before sending,
 * "photo_2026-08-08.jpg" is not enough to tell one homework scan from another,
 * and a teacher who cannot check will send the wrong page. Afterwards, the
 * sent-message screen is the only record of what the class was actually given,
 * and a filename is not a record.
 *
 * Images open here, full bleed. Anything else is handed to the app that owns
 * the format — but only once it is in storage, because a locally picked file
 * lives behind a Storage Access Framework grant that belongs to this app alone,
 * so no other app could open the URI even if handed it.
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Button, Press } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { formatBytes, signedAttachmentUrl } from '@/lib/attachments';
import { PHOTO_CACHE_POLICY } from '@/lib/studentPhoto';
import { radius, useThemedStyles } from '@/theme';
import { body, text } from '@/theme/type';

/**
 * A file to look at, wherever it currently lives.
 *
 * `uri` is a file already on the phone — picked, not yet uploaded. `storagePath`
 * is one in the bucket, which needs a signed URL minted at open time. Exactly
 * one of them is set.
 */
export type PreviewFile = {
  filename: string;
  mimeType: string;
  size: number;
  uri?: string;
  storagePath?: string;
};

export const isImage = (mimeType: string) => mimeType.startsWith('image/');

export function AttachmentPreview({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  /** The signed URL for a stored file, or null while it is being minted. */
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const path = file?.storagePath;
  const localUri = file?.uri;

  useEffect(() => {
    setFailed(false);

    if (!file) {
      setSource(null);
      return;
    }
    if (localUri) {
      setSource(localUri);
      return;
    }
    if (!path) return;

    // Signed at open time and short-lived on purpose. A homework photo of
    // somebody's child does not belong on a URL that keeps working.
    let alive = true;
    setSource(null);
    signedAttachmentUrl(path)
      .then((url) => alive && setSource(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [file, localUri, path]);

  if (!file) return null;

  const openElsewhere = async () => {
    if (!source) return;
    try {
      await Linking.openURL(source);
    } catch {
      void showAlert(t('attach.preview'), t('reply.cannotOpen'), 'danger');
    }
  };

  const showsImage = isImage(file.mimeType);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.head, { paddingTop: insets.top + 10 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {file.filename}
            </Text>
            <Text style={styles.meta}>{formatBytes(file.size)}</Text>
          </View>
          <Press
            onPress={onClose}
            hitSlop={12}
            style={styles.closeButton}
            accessibilityLabel={t('common.dismiss')}>
            <Icon name="close" size={16} color="#ffffff" />
          </Press>
        </View>

        <View style={styles.stage}>
          {failed ? (
            <View style={styles.center}>
              <Icon name="warning" size={26} color="#ffffff" />
              <Text style={styles.note}>{t('reply.cannotOpen')}</Text>
            </View>
          ) : showsImage ? (
            source ? (
              <Image
                source={{ uri: source }}
                style={styles.image}
                contentFit="contain"
                transition={120}
                /*
                  Local files are never cached; downloaded ones still are.

                  This viewer opens both a student's photo off the disk and an
                  attachment pulled from storage. The photo lives at a path that
                  never changes as the picture behind it does, so a cached copy
                  is a stale copy — see `PHOTO_CACHE_POLICY`. An attachment cost
                  mobile data to fetch and is immutable once fetched, so it keeps
                  its cache.
                */
                cachePolicy={source.startsWith('file://') ? PHOTO_CACHE_POLICY : 'disk'}
                onError={() => setFailed(true)}
              />
            ) : (
              <ActivityIndicator color="#ffffff" />
            )
          ) : (
            <View style={styles.center}>
              <View style={styles.fileGlyph}>
                <Icon name="paperclip" size={26} color="#ffffff" />
              </View>
              <Text style={styles.note}>
                {/*
                  A local file cannot be handed to another app: the read grant
                  came from the picker and is ours alone. Saying so beats an
                  Open button that fails.
                */}
                {file.storagePath ? t('attach.openElsewhere') : t('attach.localOnly')}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          {file.storagePath && !failed ? (
            <Button
              grow
              label={t('reply.openFile')}
              variant="outline"
              height={48}
              disabled={!source}
              onPress={() => void openElsewhere()}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    // Deliberately not themed. A photo reads correctly against near-black in
    // either mode, and a white viewer in light mode washes out the image it is
    // there to show.
    backdrop: { flex: 1, backgroundColor: 'rgba(9,12,20,0.97)' },

    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 20,
      paddingBottom: 14,
    },
    name: { ...text.sheetTitle, fontSize: 16, color: '#ffffff' },
    meta: { fontFamily: body[400], fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
    closeButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },

    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    image: { width: '100%', height: '100%' },

    center: { alignItems: 'center', gap: 14, paddingHorizontal: 30 },
    fileGlyph: {
      width: 66,
      height: 66,
      borderRadius: radius.tile,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    note: {
      fontFamily: body[400],
      fontSize: 13.5,
      lineHeight: 20,
      color: 'rgba(255,255,255,0.72)',
      textAlign: 'center',
    },

    foot: { paddingHorizontal: 20, paddingTop: 12, minHeight: 20 },
  });
