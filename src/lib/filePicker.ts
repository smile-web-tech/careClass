/**
 * Choosing a file, and saying so when the platform cannot.
 *
 * `File.pickFileAsync` is a native call. On web `expo-file-system` ships a stub
 * for the whole module: every method logs "expo-file-system is not supported on
 * web" to the console and resolves `undefined`.
 *
 * That is the worst shape a failure can take. The caller does
 *
 *   const picked = await File.pickFileAsync(...);
 *   if (picked.canceled) return;
 *
 * which reads `.canceled` off `undefined`, throws a `TypeError` inside an async
 * handler nobody awaited, and the rejection goes nowhere. To the teacher the
 * button simply does nothing at all: no picker, no error, no clue.
 *
 * So the check happens here, once, before the call — and it throws something
 * with a name on it, which every caller can catch and turn into a sentence.
 */
import { File, type PickSingleFileResult } from 'expo-file-system';
import { Platform } from 'react-native';

import { translateNow } from '@/i18n/useT';

/**
 * There is no file picker here.
 *
 * A distinct type rather than a generic error, because it is not a failure the
 * teacher can act on by trying again, and the callers say different things
 * about it than they say about a file that would not parse.
 */
export class NoFilePicker extends Error {
  constructor() {
    super(translateNow('error.phoneOnly'));
    this.name = 'NoFilePicker';
  }
}

/**
 * One file from the system picker.
 *
 * Callers always pass the wildcard type alongside the specific ones, because
 * Android file managers routinely hand a spreadsheet or a backup over as
 * `application/octet-stream`, and a filter that excludes it makes the teacher's
 * own file unpickable.
 */
export async function pickOneFile(mimeTypes: string[]): Promise<PickSingleFileResult> {
  if (Platform.OS === 'web') throw new NoFilePicker();

  const picked = (await File.pickFileAsync({ mimeTypes })) as PickSingleFileResult | undefined;

  // Belt and braces. A stubbed module on some future platform resolves nothing
  // the same way web does, and one undefined here is a silent dead button.
  if (!picked) throw new NoFilePicker();

  return picked;
}
