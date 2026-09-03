import { useLocalSearchParams, useRouter } from 'expo-router';

import { GroupForm } from '@/components/GroupForm';
import { useT } from '@/i18n/useT';
import { useStore } from '@/data/store';

/**
 * Create a group. The form itself is shared with the edit screen.
 *
 * Creating works offline like everything else. It used to be the one write that
 * refused to, because a group is referenced by id from then on and an unsent
 * write died with the process — so the group looked normal and then failed at
 * the worst moment, when the teacher tried to message the class. The queue is
 * now written to disk and replayed in order, so the reason is gone.
 */
export default function NewGroup() {
  const router = useRouter();
  const t = useT();
  const addGroup = useStore((s) => s.addGroup);
  // Set when the teacher came from a term's own "add a course" rather than from
  // the plain New group button, and it decides the term the course lands in.
  const { term } = useLocalSearchParams<{ term?: string }>();

  return (
    <GroupForm
      title={t('groups.new')}
      submitLabel={t('groups.create')}
      initialTerm={term}
      onSubmit={(draft) => {
        // No connectivity check any more. The write queue is durable — it is
        // written to disk and replayed in order after a relaunch — and the id
        // is minted here, so a group created in a basement classroom is a real
        // group the moment it is typed. Refusing used to be the honest answer
        // because an unsent write died with the process; it no longer does.
        const id = addGroup(draft);
        router.replace(`/group/${id}`);
      }}
    />
  );
}
