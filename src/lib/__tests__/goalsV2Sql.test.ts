/**
 * Цели недели от преподавателя (письмо ЛК_стиль_настройки_ученика.md, 16.10):
 * настоящая миграция PENDING_goals_v2.sql в PGlite поверх минимальных заглушек
 * прод-объектов. Подсчёт трёх целей, «как у курса / своё», права (ученик,
 * посторонний преподаватель), сводка «k из n», история.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const TEACHER = U(1), KID = U(2), STRANGER = U(3), OTHER_KID = U(4)
const COURSE = U(10), GROUP = U(11), COURSE2 = U(12), GROUP2 = U(13)
const ST = U(20), ST2 = U(21)

const STUBS = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.profiles (id uuid primary key, full_name text, role text not null default 'student');
create table public.students (id uuid primary key, profile_id uuid not null unique references public.profiles(id));
create table public.courses (id uuid primary key, title text, owner_id uuid);
create table public.groups (id uuid primary key, course_id uuid references public.courses(id));
create table public.group_students (group_id uuid references public.groups(id), student_id uuid references public.students(id));
create table public.app_visits (profile_id uuid, visited_on date, primary key (profile_id, visited_on));
create table public.topic_homework (id uuid primary key, topic_id uuid);
create table public.topic_homework_attempts (id uuid primary key default gen_random_uuid(), homework_id uuid, student_id uuid,
  status text, attempt_number int, submitted_at timestamptz);
create table public.topic_autocheck_answers (task_id uuid, profile_id uuid, is_correct boolean, created_at timestamptz);
create table public.student_exam_goals (profile_id uuid, subject text, goal smallint);
create table public.cat_solutions (profile_id uuid, task_id uuid, at timestamptz);
create function public.catalog_counted_solutions(p uuid) returns table (task_id uuid, at timestamptz)
  language sql stable as $$ select task_id, at from public.cat_solutions where profile_id = p $$;
create function public.is_admin_or_owner() returns boolean language sql stable as $$ select false $$;
create function public.course_is_staff(c uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.courses where id = c and owner_id = auth.uid()) $$;
create function public.auth_is_staff_of_student(s uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.group_students gs join public.groups g on g.id = gs.group_id
                  where gs.student_id = s and public.course_is_staff(g.course_id)) $$;
`

let db: PGlite
async function as(uid: string | null) { await db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']) }
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, p)
  return Object.values(r.rows[0] ?? {})[0] as T
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await db.query(sql, p); return null } catch (e) { return (e as Error).message }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec(readFileSync(path.resolve(__dirname, '../../../supabase/migrations/PENDING_goals_v2.sql'), 'utf8'))
  await db.exec(`
    insert into profiles values ('${TEACHER}', 'Учитель', 'teacher'), ('${KID}', 'Аня', 'student'), ('${STRANGER}', 'Чужой', 'teacher'), ('${OTHER_KID}', 'Петя', 'student');
    insert into students values ('${ST}', '${KID}'), ('${ST2}', '${OTHER_KID}');
    insert into courses values ('${COURSE}', 'Физика', '${TEACHER}'), ('${COURSE2}', 'Чужой курс', '${STRANGER}');
    insert into groups values ('${GROUP}', '${COURSE}'), ('${GROUP2}', '${COURSE2}');
    insert into group_students values ('${GROUP}', '${ST}'), ('${GROUP}', '${ST2}');
  `)
  // Эта неделя (понедельник по Москве) — три захода, две темы, 12 задач; прошлая — одна тема.
  const wk = await val<string>(`select public._goals_week_start()::text`)
  await db.query(`insert into app_visits select $1::uuid, d::date from generate_series($2::date, $2::date + 2, interval '1 day') d`, [KID, wk])
  for (const [i, days] of [[1, 1], [2, 2], [3, -3]] as const) {
    await db.query(`insert into topic_homework values ($1, $2)`, [U(100 + i), U(200 + i)])
    await db.query(`insert into topic_homework_attempts (homework_id, student_id, status, attempt_number, submitted_at)
      values ($1, $2, 'submitted', 1, ($3::date + $4::int)::timestamp at time zone 'Europe/Moscow' + interval '12 hours')`, [U(100 + i), ST, wk, days])
  }
  await db.query(`insert into cat_solutions select $1, gen_random_uuid(), ($2::date)::timestamp at time zone 'Europe/Moscow' + interval '13 hours' from generate_series(1, 10)`, [KID, wk])
  await db.query(`insert into topic_autocheck_answers select gen_random_uuid(), $1, true, ($2::date)::timestamp at time zone 'Europe/Moscow' + interval '14 hours' from generate_series(1, 2)`, [KID, wk])
})
afterAll(async () => { await db?.close() })

describe('цели недели (PENDING_goals_v2)', () => {
  it('прогресс за неделю: дни из app_visits, темы — сдача на этой неделе, задачи — каталог + автопроверка', async () => {
    const r = (await db.query<{ days: number; topics: number; tasks: number }>(
      `select * from public._weekly_progress_of($1, public._goals_week_start())`, [KID])).rows[0]
    expect(r).toEqual({ days: 3, topics: 2, tasks: 12 })
  })

  it('ставит только персонал курса; чужой преподаватель и ученик — 42501', async () => {
    await as(STRANGER)
    expect(await errorOf(`select course_weekly_goals_set($1, 4, 3, 20)`, [COURSE])).toMatch(/Нет доступа/)
    await as(KID)
    expect(await errorOf(`select course_weekly_goals_set($1, 4, 3, 20)`, [COURSE])).toMatch(/Нет доступа/)
    await as(TEACHER)
    expect(await errorOf(`select course_weekly_goals_set($1, 4, 3, 20)`, [COURSE])).toBeNull()
    expect(await errorOf(`select course_weekly_goals_set($1, 7, null, null)`, [COURSE])).toMatch(/check/)
  })

  it('ученик видит свои цели курса с прогрессом и не видит чужих', async () => {
    await as(KID)
    const mine = await val<Array<{ course_id: string; goals: Array<{ kind: string; target: number; progress: number; done: boolean }> }>>(`select my_weekly_goals()`)
    expect(mine).toHaveLength(1)
    expect(mine[0].course_id).toBe(COURSE)
    expect(mine[0].goals).toEqual([
      { kind: 'days', target: 4, progress: 3, done: false },
      { kind: 'topics', target: 3, progress: 2, done: false },
      { kind: 'tasks', target: 20, progress: 12, done: false },
    ])
    expect(await errorOf(`select student_goals_for_staff($1)`, [ST])).toMatch(/Нет доступа/)
  })

  it('«своё» ученику — вместо курса; «как у курса» — снова курс', async () => {
    await as(TEACHER)
    await db.query(`select student_weekly_goals_set($1, $2, true, 3, null, 10)`, [COURSE, ST])
    await as(KID)
    const own = await val<Array<{ goals: Array<{ kind: string; done: boolean }> }>>(`select my_weekly_goals()`)
    expect(own[0].goals.map(g => [g.kind, g.done])).toEqual([['days', true], ['tasks', true]])
    await as(TEACHER)
    await db.query(`select student_weekly_goals_set($1, $2, false, null, null, null)`, [COURSE, ST])
    await as(KID)
    expect((await val<Array<{ goals: unknown[] }>>(`select my_weekly_goals()`))[0].goals).toHaveLength(3)
  })

  it('сводка курса: «k из n» по ученикам; ученика не из курса не поставить', async () => {
    await as(TEACHER)
    const rows = (await db.query<{ student_id: string; goals: number; done: number }>(`select student_id, goals, done from course_goals_summary($1) order by student_id`, [COURSE])).rows
    expect(rows).toEqual([{ student_id: ST, goals: 3, done: 0 }, { student_id: ST2, goals: 3, done: 0 }])
    expect(await errorOf(`select student_weekly_goals_set($1, $2, true, 3, null, null)`, [COURSE2, ST])).toMatch(/Нет доступа/)
  })

  it('карточка ученика: цели, «как у курса», история 8 недель', async () => {
    await as(TEACHER)
    const r = await val<{ courses: Array<{ course_id: string; custom: boolean; goals: unknown[]; history: Array<{ total: number; done: number }> }> }>(
      `select student_goals_for_staff($1)`, [ST])
    expect(r.courses).toHaveLength(1)
    expect(r.courses[0]).toMatchObject({ course_id: COURSE, custom: false })
    expect(r.courses[0].history).toHaveLength(8)
    expect(r.courses[0].history[7].total).toBe(3)
  })
})
