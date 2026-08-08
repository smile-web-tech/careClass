/**
 * The words for a message's audience and channels, in the teacher's language.
 *
 * These lived as English constant maps in two screens — `AUDIENCE_LABEL` and
 * `CHANNEL_LABEL` — so a Turkmen teacher's message list read "Students +
 * parents" and "Delivered 8/8" no matter what they had chosen. The strings
 * existed in the catalogue the whole time; nothing was looking them up.
 *
 * One module because both screens show the same message and must not drift.
 */
import type { Audience, Channel } from '@/data/types';
import type { TranslationKey } from '@/i18n';

const AUDIENCE: Record<Audience, TranslationKey> = {
  students: 'messages.audienceStudents',
  parents: 'messages.audienceParents',
  both: 'messages.audienceBoth',
};

const CHANNEL: Record<Channel, TranslationKey> = {
  sms: 'messages.channelSms',
  email: 'messages.channelEmail',
  // Never sent — the server's `sendPush` for recipients is a documented no-op —
  // but old rows still carry it, so it needs a word rather than `undefined`.
  push: 'messages.channelPush',
};

export const audienceKey = (audience: Audience): TranslationKey => AUDIENCE[audience];
export const channelKey = (channel: Channel): TranslationKey => CHANNEL[channel];
