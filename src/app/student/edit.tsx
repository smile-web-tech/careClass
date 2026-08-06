import { useLocalSearchParams, useRouter } from 'expo-router';

import { StudentForm } from '@/components/StudentForm';
import { useStore, useStudent } from '@/data/store';

/**
 * Edit an existing student. Everything set at creation can be changed here,
 * including the contact details the message fan-out depends on — a student
 * added before the email fields existed has no address on file, and without
 * this screen there would be no way to add one.
 */
export default function EditStudent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const student = useStudent(id);
  const updateStudent = useStore((s) => s.updateStudent);

  return (
    <StudentForm
      title="Edit student"
      submitLabel="Save changes"
      initial={student}
      onSubmit={(draft) => {
        if (student) updateStudent(student.id, draft);
        router.back();
      }}
    />
  );
}
