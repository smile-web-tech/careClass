import type { Group, Message, Reply, Student } from '@/data/types';

/**
 * Development seed. Mirrors the roster in the Claude Design mockups so the
 * screens look like the source of truth before Supabase is wired in.
 *
 * Sessions are NOT seeded — they're derived from each group's weekly `slots`,
 * so the app shows a live schedule whatever day it is opened.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const teacher = {
  name: 'Lina Kamalova',
  email: 'lina@classcare.app',
};

export const seedGroups: Group[] = [
  {
    id: 'g-ielts',
    name: 'IELTS Advanced',
    subject: 'English',
    accent: 'blue',
    room: 'Room 2',
    slots: [
      { day: 1, start: '16:00', end: '17:30' },
      { day: 3, start: '16:00', end: '17:30' },
      { day: 5, start: '16:00', end: '17:30' },
    ],
  },
  {
    id: 'g-algebra',
    name: 'Grade 9 Algebra',
    subject: 'Mathematics',
    accent: 'teal',
    room: 'Room 1',
    slots: [
      { day: 1, start: '10:30', end: '12:00' },
      { day: 5, start: '10:30', end: '12:00' },
    ],
  },
  {
    id: 'g-beginners',
    name: 'Beginners A1',
    subject: 'English',
    accent: 'violet',
    room: 'Room 3',
    slots: [
      { day: 2, start: '18:00', end: '19:30' },
      { day: 3, start: '18:00', end: '19:30' },
      { day: 6, start: '11:00', end: '12:30' },
    ],
  },
  {
    id: 'g-physics',
    name: 'Physics Intensive',
    subject: 'Physics',
    accent: 'amber',
    room: 'Room 1',
    slots: [
      { day: 4, start: '15:00', end: '16:30' },
      { day: 5, start: '18:30', end: '20:00' },
    ],
  },
];

/** Accents cycle in roster order, matching the attendance grid in the design. */
const CYCLE = ['blue', 'teal', 'violet', 'amber'] as const;

type Draft = Omit<Student, 'id' | 'accent'> & { id: string };

const drafts: Draft[] = [
  {
    id: 's-amir',
    name: 'Amir Rasulov',
    phone: '+993 61 186357',
    email: 'amir.rasulov@mail.com',
    parentName: 'Gulnora R.',
    parentPhone: '+993 62 668583',
    parentEmail: 'gulnora.rasulova@mail.com',
    groupIds: ['g-ielts', 'g-algebra'],
    avgScore: 8.2,
    note: 'Strong in reading, needs work on speaking fluency. Prefers evening slots — mother asked to avoid Monday mornings.',
  },
  {
    id: 's-dilnoza',
    name: 'Dilnoza Karimova',
    phone: '+993 63 742987',
    email: 'dilnoza.k@mail.com',
    parentName: 'Nodira K.',
    parentPhone: '+993 65 333134',
    parentEmail: 'nodira.karimova@mail.com',
    groupIds: ['g-ielts'],
    avgScore: 7.1,
  },
  {
    id: 's-jasur',
    name: 'Jasur Toshev',
    phone: '+993 63 894948',
    parentName: 'Anvar T.',
    parentPhone: '+993 64 375637',
    parentEmail: 'anvar.toshev@mail.com',
    groupIds: ['g-ielts'],
    avgScore: 7.8,
  },
  {
    id: 's-malika',
    name: 'Malika Yusupova',
    phone: '+993 63 749598',
    groupIds: ['g-ielts'],
    avgScore: 6.9,
  },
  {
    id: 's-timur',
    name: 'Timur Aliyev',
    phone: '+993 64 351509',
    email: 'timur.aliyev@mail.com',
    parentName: 'Shoira A.',
    parentPhone: '+993 63 418586',
    parentEmail: 'shoira.aliyeva@mail.com',
    groupIds: ['g-ielts', 'g-algebra'],
    avgScore: 8.6,
  },
  {
    id: 's-sabina',
    name: 'Sabina Ismoilova',
    phone: '+993 61 140915',
    groupIds: ['g-ielts', 'g-beginners'],
    avgScore: 7.4,
  },
  {
    id: 's-otabek',
    name: 'Otabek Nazarov',
    phone: '+993 61 342188',
    parentName: 'Rustam N.',
    parentPhone: '+993 65 306098',
    parentEmail: 'rustam.nazarov@mail.com',
    groupIds: ['g-ielts'],
    avgScore: 6.2,
  },
  {
    id: 's-nigora',
    name: 'Nigora Sattorova',
    phone: '+993 64 695519',
    groupIds: ['g-ielts', 'g-physics'],
    avgScore: 7.9,
  },
  {
    id: 's-bekzod',
    name: 'Bekzod Umarov',
    phone: '+993 61 920352',
    parentName: 'Zuhra U.',
    parentPhone: '+993 71 732872',
    parentEmail: 'zuhra.umarova@mail.com',
    groupIds: ['g-algebra', 'g-physics'],
    avgScore: 8.0,
  },
  {
    id: 's-kamola',
    name: 'Kamola Yusupova',
    phone: '+993 61 705657',
    groupIds: ['g-algebra', 'g-beginners'],
    avgScore: 7.3,
  },
  {
    id: 's-aziz',
    name: 'Aziz Karimov',
    phone: '+993 65 191750',
    groupIds: ['g-algebra'],
    avgScore: 6.8,
  },
  {
    id: 's-zilola',
    name: 'Zilola Rakhimova',
    phone: '+993 71 152932',
    groupIds: ['g-algebra'],
    avgScore: 8.4,
  },
  {
    id: 's-shahzod',
    name: 'Shahzod Mirzaev',
    phone: '+993 63 925459',
    groupIds: ['g-beginners'],
    avgScore: 6.5,
  },
  {
    id: 's-madina',
    name: 'Madina Tursunova',
    phone: '+993 71 986909',
    groupIds: ['g-beginners'],
    avgScore: 7.0,
  },
  {
    id: 's-javohir',
    name: 'Javohir Ergashev',
    phone: '+993 62 849557',
    groupIds: ['g-beginners'],
    avgScore: 5.9,
  },
  {
    id: 's-nilufar',
    name: 'Nilufar Qodirova',
    phone: '+993 61 899618',
    groupIds: ['g-beginners'],
    avgScore: 7.6,
  },
  {
    id: 's-sardor',
    name: 'Sardor Alimov',
    phone: '+993 71 394940',
    groupIds: ['g-beginners'],
    avgScore: 6.1,
  },
  {
    id: 's-dilshod',
    name: 'Dilshod Yuldashev',
    phone: '+993 65 739747',
    groupIds: ['g-beginners'],
    avgScore: 6.7,
  },
  {
    id: 's-feruza',
    name: 'Feruza Nazirova',
    phone: '+993 64 110405',
    groupIds: ['g-beginners'],
    avgScore: 7.2,
  },
  {
    id: 's-ulugbek',
    name: 'Ulugbek Sobirov',
    phone: '+993 64 879187',
    groupIds: ['g-beginners'],
    avgScore: 5.8,
  },
  {
    id: 's-aziza',
    name: 'Aziza Tashkentova',
    phone: '+993 63 823829',
    groupIds: ['g-beginners'],
    avgScore: 8.1,
  },
  {
    id: 's-rustam',
    name: 'Rustam Ibragimov',
    phone: '+993 63 904374',
    groupIds: ['g-physics'],
    avgScore: 8.8,
  },
  {
    id: 's-laziza',
    name: 'Laziza Sharipova',
    phone: '+993 62 318010',
    groupIds: ['g-physics'],
    avgScore: 7.7,
  },
];

export const seedStudents: Student[] = drafts.map((d, i) => ({
  ...d,
  accent: CYCLE[i % CYCLE.length],
}));

export const seedMessages: Message[] = [
  {
    id: 'm-1',
    groupIds: ['g-ielts'],
    audience: 'students',
    channels: ['sms', 'push'],
    body: 'Reminder: bring your speaking workbooks today. We start with part 2 practice.',
    sentAt: Date.now() - 2 * HOUR,
    delivered: 8,
    total: 8,
  },
  {
    id: 'm-2',
    groupIds: [],
    audience: 'parents',
    channels: ['sms', 'email'],
    body: 'No classes next Monday — public holiday. All sessions move to Tuesday at the usual times.',
    sentAt: Date.now() - DAY,
    delivered: 29,
    total: 29,
    announcement: true,
  },
  {
    id: 'm-3',
    groupIds: ['g-algebra'],
    audience: 'parents',
    channels: ['email'],
    body: 'Mid-term results are in. Individual scores were sent to each parent separately.',
    sentAt: Date.now() - 2 * DAY,
    delivered: 5,
    total: 6,
  },
];

export const seedReplies: Reply[] = [
  {
    id: 'r-1',
    authorName: 'Gulnora R.',
    context: 'parent of Amir',
    accent: 'violet',
    body: 'Thank you! Amir will be 10 minutes late today, he has a dentist appointment.',
    at: Date.now() - 18 * 60_000,
    unread: true,
  },
  {
    id: 'r-2',
    authorName: 'Timur Aliyev',
    context: 'Grade 9 Algebra',
    accent: 'teal',
    body: "Could you resend the homework file? I can't open the link.",
    at: Date.now() - HOUR,
    unread: true,
  },
  {
    id: 'r-3',
    authorName: 'Sabina Ismoilova',
    context: 'Beginners A1',
    accent: 'blue',
    body: 'Got it, see you Wednesday!',
    at: Date.now() - DAY,
    unread: true,
  },
  {
    id: 'r-4',
    authorName: 'Bekzod Umarov',
    context: 'Physics Intensive',
    accent: 'amber',
    body: 'Understood, thanks for the reminder.',
    at: Date.now() - 3 * DAY,
    unread: false,
  },
];

/** Message templates offered by the composer's "Templates" action. */
export const messageTemplates = [
  {
    id: 't-remind',
    title: 'Class reminder',
    body: 'Hi {name}, reminder: {group} meets today at {time}. Please bring your workbook.',
  },
  {
    id: 't-cancel',
    title: 'Class cancelled',
    body: "Hi {name}, today's {group} session at {time} is cancelled. I will confirm the make-up time shortly.",
  },
  {
    id: 't-absence',
    title: 'Absence follow-up',
    body: "Hello, {name} missed today's {group} session. Please let me know if everything is alright.",
  },
  {
    id: 't-homework',
    title: 'Homework due',
    body: 'Hi {name}, homework for {group} is due at our next class. Send it over if you have questions.',
  },
];
