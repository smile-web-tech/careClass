/**
 * Database types for the schema in `supabase/migrations/0001_init.sql`.
 *
 * Hand-written to match. Once the project is linked you can regenerate with:
 *   npx supabase gen types typescript --linked > src/lib/database.types.ts
 */

export type AttendanceStatusRow = 'present' | 'late' | 'absent';
export type MessageAudienceRow = 'students' | 'parents' | 'both';
export type MessageChannelRow = 'sms' | 'email' | 'push';
export type DeliveryStateRow = 'queued' | 'sent' | 'delivered' | 'failed';
export type GroupAccentRow = 'blue' | 'teal' | 'violet' | 'amber';

type Row<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type TeacherRow = {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  timezone: string;
  push_token: string | null;
  created_at: string;
};

export type GroupRow = {
  id: string;
  teacher_id: string;
  name: string;
  subject: string;
  room: string;
  accent: GroupAccentRow;
  archived_at: string | null;
  created_at: string;
};

export type GroupSlotRow = {
  id: string;
  group_id: string;
  teacher_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
};

export type StudentRow = {
  id: string;
  teacher_id: string;
  name: string;
  phone: string;
  email: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  accent: GroupAccentRow;
  note: string | null;
  avg_score: number | null;
  photo_url: string | null;
  archived_at: string | null;
  created_at: string;
};

export type StudentGroupRow = {
  student_id: string;
  group_id: string;
  teacher_id: string;
  joined_at: string;
};

export type AttendanceRow = {
  id: string;
  teacher_id: string;
  group_id: string;
  student_id: string;
  session_date: string;
  starts_at: string;
  status: AttendanceStatusRow;
  marked_at: string;
};

export type MessageRow = {
  id: string;
  teacher_id: string;
  body: string;
  audience: MessageAudienceRow;
  channels: MessageChannelRow[];
  announcement: boolean;
  sent_at: string;
};

export type MessageGroupRow = { message_id: string; group_id: string };

export type MessageDeliveryRow = {
  id: string;
  message_id: string;
  teacher_id: string;
  student_id: string | null;
  recipient: 'student' | 'parent';
  channel: MessageChannelRow;
  destination: string;
  rendered: string;
  state: DeliveryStateRow;
  provider_id: string | null;
  error: string | null;
  updated_at: string;
};

export type ReplyRow = {
  id: string;
  teacher_id: string;
  student_id: string | null;
  author_name: string;
  context: string;
  body: string;
  received_at: string;
  read_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      teachers: Row<TeacherRow>;
      groups: Row<GroupRow>;
      group_slots: Row<GroupSlotRow>;
      students: Row<StudentRow>;
      student_groups: Row<StudentGroupRow>;
      attendance: Row<AttendanceRow>;
      messages: Row<MessageRow>;
      message_groups: Row<MessageGroupRow>;
      message_deliveries: Row<MessageDeliveryRow>;
      replies: Row<ReplyRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      attendance_status: AttendanceStatusRow;
      message_audience: MessageAudienceRow;
      message_channel: MessageChannelRow;
      delivery_state: DeliveryStateRow;
      group_accent: GroupAccentRow;
    };
    CompositeTypes: Record<string, never>;
  };
};
