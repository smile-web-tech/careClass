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
    phone: '+998 90 123 45 67',
    email: 'amir.rasulov@mail.com',
    parentName: 'Gulnora R.',
    parentPhone: '+998 90 987 65 43',
    groupIds: ['g-ielts', 'g-algebra'],
    avgScore: 8.2,
    note: 'Strong in reading, needs work on speaking fluency. Prefers evening slots — mother asked to avoid Monday mornings.',
  },
  {
    id: 's-dilnoza',
    name: 'Dilnoza Karimova',
    phone: '+998 91 234 56 78',
    email: 'dilnoza.k@mail.com',
    parentName: 'Nodira K.',
    parentPhone: '+998 91 111 22 33',
    groupIds: ['g-ielts'],
    avgScore: 7.1,
  },
  {
    id: 's-jasur',
    name: 'Jasur Toshev',
    phone: '+998 93 345 67 89',
    parentName: 'Anvar T.',
    parentPhone: '+998 93 222 33 44',
    groupIds: ['g-ielts'],
    avgScore: 7.8,
  },
  {
    id: 's-malika',
    name: 'Malika Yusupova',
    phone: '+998 94 456 78 90',
    groupIds: ['g-ielts'],
    avgScore: 6.9,
  },
  {
    id: 's-timur',
    name: 'Timur Aliyev',
    phone: '+998 95 567 89 01',
    email: 'timur.aliyev@mail.com',
    parentName: 'Shoira A.',
    parentPhone: '+998 95 333 44 55',
    groupIds: ['g-ielts', 'g-algebra'],
    avgScore: 8.6,
  },
  {
    id: 's-sabina',
    name: 'Sabina Ismoilova',
    phone: '+998 97 678 90 12',
    groupIds: ['g-ielts', 'g-beginners'],
    avgScore: 7.4,
  },
  {
    id: 's-otabek',
    name: 'Otabek Nazarov',
    phone: '+998 88 789 01 23',
    parentName: 'Rustam N.',
    parentPhone: '+998 88 444 55 66',
    groupIds: ['g-ielts'],
    avgScore: 6.2,
  },
  {
    id: 's-nigora',
    name: 'Nigora Sattorova',
    phone: '+998 90 890 12 34',
    groupIds: ['g-ielts', 'g-physics'],
    avgScore: 7.9,
  },
  {
    id: 's-bekzod',
    name: 'Bekzod Umarov',
    phone: '+998 91 901 23 45',
    parentName: 'Zuhra U.',
    parentPhone: '+998 91 555 66 77',
    groupIds: ['g-algebra', 'g-physics'],
    avgScore: 8.0,
  },
  {
    id: 's-kamola',
    name: 'Kamola Yusupova',
    phone: '+998 93 012 34 56',
    groupIds: ['g-algebra', 'g-beginners'],
    avgScore: 7.3,
  },
  {
    id: 's-aziz',
    name: 'Aziz Karimov',
    phone: '+998 94 123 45 60',
    groupIds: ['g-algebra'],
    avgScore: 6.8,
  },
  {
    id: 's-zilola',
    name: 'Zilola Rakhimova',
    phone: '+998 95 234 56 71',
    groupIds: ['g-algebra'],
    avgScore: 8.4,
  },
  {
    id: 's-shahzod',
    name: 'Shahzod Mirzaev',
    phone: '+998 97 345 67 82',
    groupIds: ['g-beginners'],
    avgScore: 6.5,
  },
  {
    id: 's-madina',
    name: 'Madina Tursunova',
    phone: '+998 88 456 78 93',
    groupIds: ['g-beginners'],
    avgScore: 7.0,
  },
  {
    id: 's-javohir',
    name: 'Javohir Ergashev',
    phone: '+998 90 567 89 04',
    groupIds: ['g-beginners'],
    avgScore: 5.9,
  },
  {
    id: 's-nilufar',
    name: 'Nilufar Qodirova',
    phone: '+998 91 678 90 15',
    groupIds: ['g-beginners'],
    avgScore: 7.6,
  },
  {
    id: 's-sardor',
    name: 'Sardor Alimov',
    phone: '+998 93 789 01 26',
    groupIds: ['g-beginners'],
    avgScore: 6.1,
  },
  {
    id: 's-dilshod',
    name: 'Dilshod Yuldashev',
    phone: '+998 94 890 12 37',
    groupIds: ['g-beginners'],
    avgScore: 6.7,
  },
  {
    id: 's-feruza',
    name: 'Feruza Nazirova',
    phone: '+998 95 901 23 48',
    groupIds: ['g-beginners'],
    avgScore: 7.2,
  },
  {
    id: 's-ulugbek',
    name: 'Ulugbek Sobirov',
    phone: '+998 97 012 34 59',
    groupIds: ['g-beginners'],
    avgScore: 5.8,
  },
  {
    id: 's-aziza',
    name: 'Aziza Tashkentova',
    phone: '+998 88 123 45 61',
    groupIds: ['g-beginners'],
    avgScore: 8.1,
  },
  {
    id: 's-rustam',
    name: 'Rustam Ibragimov',
    phone: '+998 90 234 56 72',
    groupIds: ['g-physics'],
    avgScore: 8.8,
  },
  {
    id: 's-laziza',
    name: 'Laziza Sharipova',
    phone: '+998 91 345 67 83',
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
