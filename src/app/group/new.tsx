import { useRouter } from 'expo-router';
import { useState } from 'react';

import { showAlert } from '@/components/Dialog';
import { GroupForm } from '@/components/GroupForm';
import { useT } from '@/i18n/useT';
import { useStore } from '@/data/store';
import { isReachable } from '@/data/sync';

/**
 * Create a group. The form itself is shared with the edit screen.
 *
 * Creating is the one write that refuses to happen offline. Everything else in
 * the app applies locally and syncs later, which is right for attendance on bad
 * classroom wifi — but a group is referenced by id from then on. One created
 * while the server was unreachable looks completely normal and then fails at
 * the worst moment, when the teacher tries to message the class with it.
 */
export default function NewGroup() {
  const router = useRouter();
  const t = useT();
  const addGroup = useStore((s) => s.addGroup);
  const [checking, setChecking] = useState(false);

  return (
    <GroupForm
      title={t('groups.new')}
      submitLabel={checking ? t('common.checking') : t('groups.create')}
      busy={checking}
      onSubmit={async (draft) => {
        setChecking(true);
        const online = await isReachable();
        setChecking(false);

        if (!online) {
          await showAlert(t('common.noInternet'), t('groups.noInternetCreate'), 'danger');
          return;
        }

        const id = addGroup(draft);
        router.replace(`/group/${id}`);
      }}
    />
  );
}
