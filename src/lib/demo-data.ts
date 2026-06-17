// Demo data for offline/development mode (when Supabase is not connected)
import type { Profile, Student, Group, Lesson, Homework, MockExam, Payment, Achievement, LeaderboardEntry } from '@/types'

export const demoProfiles: Profile[] = [
  { id: 'student-1', email: 'alex@demo.ru', full_name: 'Алексей Петров', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-2', email: 'maria@demo.ru', full_name: 'Мария Иванова', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-3', email: 'dima@demo.ru', full_name: 'Дмитрий Козлов', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-4', email: 'anna@demo.ru', full_name: 'Анна Сидорова', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-5', email: 'ivan@demo.ru', full_name: 'Иван Новиков', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-6', email: 'sofia@demo.ru', full_name: 'София Морозова', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-7', email: 'nikita@demo.ru', full_name: 'Никита Волков', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-8', email: 'kate@demo.ru', full_name: 'Екатерина Лебедева', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-9', email: 'pavel@demo.ru', full_name: 'Павел Зайцев', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'student-10', email: 'olga@demo.ru', full_name: 'Ольга Семёнова', role: 'student', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'parent-1', email: 'petrov-parent@demo.ru', full_name: 'Сергей Петров', role: 'parent', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'parent-2', email: 'ivanova-parent@demo.ru', full_name: 'Елена Иванова', role: 'parent', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'parent-3', email: 'kozlov-parent@demo.ru', full_name: 'Андрей Козлов', role: 'parent', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'teacher-1', email: 'physics@demo.ru', full_name: 'Виктор Андреев', role: 'teacher', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'teacher-2', email: 'math@demo.ru', full_name: 'Наталья Фёдорова', role: 'teacher', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'curator-1', email: 'curator@demo.ru', full_name: 'Светлана Кириллова', role: 'curator', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'admin-1', email: 'admin@demo.ru', full_name: 'Администратор', role: 'admin', created_at: '2024-09-01', updated_at: '2024-09-01' },
  { id: 'owner-1', email: 'owner@demo.ru', full_name: 'Алмирон Ректор', role: 'owner', created_at: '2024-09-01', updated_at: '2024-09-01' },
]

export const demoStudents: Student[] = [
  { id: 's1', profile_id: 'student-1', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 85, xp_points: 2450, league: 'silver', is_active: true, created_at: '2024-09-01', profile: demoProfiles[0] },
  { id: 's2', profile_id: 'student-2', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 90, xp_points: 3820, league: 'gold', is_active: true, created_at: '2024-09-01', profile: demoProfiles[1] },
  { id: 's3', profile_id: 'student-3', grade: 10, target_exam: 'oge', target_subject: 'math', target_score: 4, xp_points: 1200, league: 'bronze', is_active: true, created_at: '2024-09-01', profile: demoProfiles[2] },
  { id: 's4', profile_id: 'student-4', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 80, xp_points: 5100, league: 'platinum', is_active: true, created_at: '2024-09-01', profile: demoProfiles[3] },
  { id: 's5', profile_id: 'student-5', grade: 10, target_exam: 'oge', target_subject: 'math', target_score: 5, xp_points: 980, league: 'bronze', is_active: true, created_at: '2024-09-01', profile: demoProfiles[4] },
  { id: 's6', profile_id: 'student-6', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 95, xp_points: 6200, league: 'academic', is_active: true, created_at: '2024-09-01', profile: demoProfiles[5] },
  { id: 's7', profile_id: 'student-7', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 75, xp_points: 1750, league: 'bronze', is_active: true, created_at: '2024-09-01', profile: demoProfiles[6] },
  { id: 's8', profile_id: 'student-8', grade: 10, target_exam: 'oge', target_subject: 'math', target_score: 4, xp_points: 2100, league: 'silver', is_active: true, created_at: '2024-09-01', profile: demoProfiles[7] },
  { id: 's9', profile_id: 'student-9', grade: 11, target_exam: 'ege', target_subject: 'physics', target_score: 88, xp_points: 3400, league: 'gold', is_active: true, created_at: '2024-09-01', profile: demoProfiles[8] },
  { id: 's10', profile_id: 'student-10', grade: 10, target_exam: 'oge', target_subject: 'math', target_score: 5, xp_points: 4500, league: 'gold', is_active: true, created_at: '2024-09-01', profile: demoProfiles[9] },
]

export const demoGroups: Group[] = [
  { id: 'g1', name: 'ЕГЭ Физика 11А', max_students: 8, schedule_days: ['tuesday', 'friday'], schedule_time: '18:00', is_active: true, created_at: '2024-09-01', student_count: 6 },
  { id: 'g2', name: 'ЕГЭ Физика 11Б', max_students: 8, schedule_days: ['monday', 'thursday'], schedule_time: '19:00', is_active: true, created_at: '2024-09-01', student_count: 4 },
  { id: 'g3', name: 'ОГЭ Математика 10', max_students: 10, schedule_days: ['wednesday', 'saturday'], schedule_time: '17:00', is_active: true, created_at: '2024-09-01', student_count: 4 },
]

export const demoLessons: Lesson[] = [
  {
    id: 'l1', group_id: 'g1', teacher_id: 't1', title: 'Механика: динамика', scheduled_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    duration_minutes: 90, status: 'scheduled', zoom_link: 'https://zoom.us/j/demo', created_at: '2024-10-01'
  },
  {
    id: 'l2', group_id: 'g1', teacher_id: 't1', title: 'Механика: кинематика', scheduled_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    duration_minutes: 90, status: 'completed', created_at: '2024-10-01'
  },
  {
    id: 'l3', group_id: 'g3', teacher_id: 't2', title: 'Алгебра: уравнения', scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 90, status: 'scheduled', zoom_link: 'https://zoom.us/j/demo2', created_at: '2024-10-01'
  },
]

export const demoHomeworks: Homework[] = [
  {
    id: 'hw1', group_id: 'g1', title: 'Задачи по кинематике (§3)', description: 'Решить задачи 3.1–3.10', due_date: new Date(Date.now() + 86400000 * 5).toISOString(),
    max_score: 100, created_by: 't1', created_at: '2024-10-10'
  },
  {
    id: 'hw2', group_id: 'g1', title: 'Динамика: законы Ньютона', description: 'Задачи из сборника Иродова, стр. 15–18', due_date: new Date(Date.now() - 86400000 * 2).toISOString(),
    max_score: 100, created_by: 't1', created_at: '2024-10-05',
    submission: { id: 'sub1', homework_id: 'hw2', student_id: 's1', status: 'checked', score: 78, submitted_at: '2024-10-07', checked_at: '2024-10-08' }
  },
  {
    id: 'hw3', group_id: 'g3', title: 'Квадратные уравнения', description: 'Учебник стр. 45, упр. 1–15', due_date: new Date(Date.now() + 86400000 * 3).toISOString(),
    max_score: 100, created_by: 't2', created_at: '2024-10-12'
  },
]

export const demoMockExams: MockExam[] = [
  { id: 'me1', title: 'Пробник ЕГЭ #1', subject: 'physics', exam_type: 'ege', group_id: 'g1', date: new Date(Date.now() - 86400000 * 10).toISOString(), max_score: 100, created_at: '2024-10-01' },
  { id: 'me2', title: 'Пробник ЕГЭ #2', subject: 'physics', exam_type: 'ege', group_id: 'g1', date: new Date(Date.now() - 86400000 * 5).toISOString(), max_score: 100, created_at: '2024-10-15' },
  { id: 'me3', title: 'Пробник ОГЭ #1', subject: 'math', exam_type: 'oge', group_id: 'g3', date: new Date(Date.now() - 86400000 * 7).toISOString(), max_score: 32, created_at: '2024-10-08' },
]

export const demoPayments: Payment[] = [
  { id: 'p1', student_id: 's1', amount: 8000, status: 'paid', description: 'Оплата за ноябрь', due_date: '2024-11-01', paid_at: '2024-10-30', created_at: '2024-10-25' },
  { id: 'p2', student_id: 's1', amount: 8000, status: 'pending', description: 'Оплата за декабрь', due_date: '2024-12-01', created_at: '2024-11-25' },
  { id: 'p3', student_id: 's2', amount: 8000, status: 'paid', description: 'Оплата за ноябрь', due_date: '2024-11-01', paid_at: '2024-10-28', created_at: '2024-10-25' },
  { id: 'p4', student_id: 's3', amount: 6000, status: 'overdue', description: 'Оплата за октябрь', due_date: '2024-10-01', created_at: '2024-09-25' },
  { id: 'p5', student_id: 's4', amount: 8000, status: 'paid', description: 'Оплата за ноябрь', due_date: '2024-11-01', paid_at: '2024-11-01', created_at: '2024-10-25' },
  { id: 'p6', student_id: 's5', amount: 6000, status: 'paid', description: 'Оплата за ноябрь', due_date: '2024-11-01', paid_at: '2024-10-29', created_at: '2024-10-25' },
]

export const demoAchievements: Achievement[] = [
  { id: 'a1', title: 'Первое ДЗ', description: 'Сдал первое домашнее задание', icon: '📝', xp_reward: 50, condition_type: 'homework', condition_value: 1, created_at: '2024-09-01' },
  { id: 'a2', title: 'Отличник', description: 'Набрал 90+ баллов за ДЗ', icon: '⭐', xp_reward: 100, condition_type: 'score', condition_value: 90, created_at: '2024-09-01' },
  { id: 'a3', title: 'Посещаемость 100%', description: '10 занятий без пропусков', icon: '✅', xp_reward: 150, condition_type: 'attendance', condition_value: 10, created_at: '2024-09-01' },
  { id: 'a4', title: 'Пробник сдан', description: 'Прошёл первый пробный экзамен', icon: '📋', xp_reward: 100, condition_type: 'exam', condition_value: 1, created_at: '2024-09-01' },
  { id: 'a5', title: 'Серия 5', description: 'Сдал 5 ДЗ подряд', icon: '🔥', xp_reward: 200, condition_type: 'streak', condition_value: 5, created_at: '2024-09-01' },
  { id: 'a6', title: 'Топ-3 рейтинга', description: 'Вошёл в топ-3 класса', icon: '🏆', xp_reward: 300, condition_type: 'score', condition_value: 95, created_at: '2024-09-01' },
]

export const demoLeaderboard: LeaderboardEntry[] = demoStudents
  .sort((a, b) => b.xp_points - a.xp_points)
  .map((s, i) => ({
    student_id: s.id,
    full_name: s.profile?.full_name || '',
    xp_points: s.xp_points,
    league: s.league,
    rank: i + 1,
  }))
