import { useRouter } from 'expo-router';

import { GroupForm } from '@/components/GroupForm';
import { useStore } from '@/data/store';

/** Create a group. The form itself is shared with the edit screen. */
export default function NewGroup() {
  const router = useRouter();
  const addGroup = useStore((s) => s.addGroup);

  return (
    <GroupForm
      title="New group"
      submitLabel="Create group"
      onSubmit={(draft) => {
        const id = addGroup(draft);
        router.replace(`/group/${id}`);
      }}
    />
  );
}
