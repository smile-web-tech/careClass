import { useRouter } from 'expo-router';
import { useState } from 'react';

import { showAlert } from '@/components/Dialog';
import { GroupForm } from '@/components/GroupForm';
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
  const addGroup = useStore((s) => s.addGroup);
  const [checking, setChecking] = useState(false);

  return (
    <GroupForm
      title="New group"
      submitLabel={checking ? 'Checking…' : 'Create group'}
      busy={checking}
      onSubmit={async (draft) => {
        setChecking(true);
        const online = await isReachable();
        setChecking(false);

        if (!online) {
          await showAlert(
            'No internet',
            'A new group has to reach the server. Connect and try again.',
            'danger',
          );
          return;
        }

        const id = addGroup(draft);
        router.replace(`/group/${id}`);
      }}
    />
  );
}
