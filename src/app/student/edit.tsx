import { useLocalSearchParams, useRouter } from 'expo-router';

import { StudentForm } from '@/components/StudentForm';
import { useT } from '@/i18n/useT';
import { useStore, useStudent } from '@/data/store';
import { remote } from '@/data/sync';

/**
 * Edit an existing student. Everything set at creation can be changed here,
 * including the contact details the message fan-out depends on — a student
 * added before the email fields existed has no address on file, and without
 * this screen there would be no way to add one.
 */
export default function EditStudent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const student = useStudent(id);
  const updateStudent = useStore((s) => s.updateStudent);

  return (
    <StudentForm
      title={t('students.edit')}
      submitLabel={t('common.saveChanges')}
      initial={student}
      onSubmit={(draft) => {
        if (!student) return;
        updateStudent(student.id, draft);
        // The picture may have been taken, replaced or removed while the form
        // was open. The op works out which when it runs.
        remote.uploadStudentPhoto?.(student.id);
        router.back();
      }}
    />
  );
}
