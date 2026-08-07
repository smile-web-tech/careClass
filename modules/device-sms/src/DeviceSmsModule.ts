import { requireOptionalNativeModule } from 'expo';

import type { DeviceSmsModuleType } from './DeviceSms.types';

/**
 * Optional on purpose. The module is Android-only — iOS has no API for sending
 * an SMS without the user tapping send in the system composer, at any price —
 * so this is `null` there, and on any build that has not been rebuilt since the
 * module was added. Callers must check.
 */
export default requireOptionalNativeModule<DeviceSmsModuleType>('DeviceSms');
