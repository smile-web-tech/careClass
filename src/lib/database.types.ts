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
export type AssessmentKindRow = 'quiz' | 'exam' | 'final';
export type GroupAccentRow =
  | 'blue'
  | 'teal'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'emerald'
  | 'indigo'
  | 'orange'
  | 'cyan'
  | 'pink'
  | 'lime'
  | 'slate';

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
  phone: string | null;
  /** 'tk' | 'ru' — the app's language and the language students are written in. */
  language: string;
  /** The teacher's own wording for a result. Null means use the app default. */
  grade_template: string | null;
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
  parent_email: string | null;
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
  is_assignment: boolean;
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
  /** RFC 5322 Message-ID of the inbound mail, so webhook retries can't duplicate. */
  inbound_message_id: string | null;
};

export type CalendarEventRow = {
  id: string;
  teacher_id: string;
  title: string;
  note: string | null;
  event_date: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  accent: GroupAccentRow;
  created_at: string;
  updated_at: string;
};

export type AssessmentRow = {
  id: string;
  teacher_id: string;
  group_id: string;
  /** Null since migration 0012; only rows older than that still carry it. */
  kind: AssessmentKindRow | null;
  /** The teacher's own name for this kind, copied at creation. */
  kind_label: string | null;
  title: string;
  max_score: number;
  taken_on: string;
  created_at: string;
};

export type AssessmentTypeRow = {
  id: string;
  teacher_id: string;
  group_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type GradeRow = {
  id: string;
  teacher_id: string;
  assessment_id: string;
  student_id: string;
  score: number;
  /** Null until the student has been told. */
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageTemplateRow = {
  id: string;
  teacher_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
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
      calendar_events: Row<CalendarEventRow>;
      assessments: Row<AssessmentRow>;
      assessment_types: Row<AssessmentTypeRow>;
      grades: Row<GradeRow>;
      message_templates: Row<MessageTemplateRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      attendance_status: AttendanceStatusRow;
      message_audience: MessageAudienceRow;
      message_channel: MessageChannelRow;
      delivery_state: DeliveryStateRow;
      group_accent: GroupAccentRow;
      assessment_kind: AssessmentKindRow;
    };
    CompositeTypes: Record<string, never>;
  };
};
