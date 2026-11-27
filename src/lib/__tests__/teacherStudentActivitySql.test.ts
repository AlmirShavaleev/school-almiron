import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(path.resolve(import.meta.dirname, '../../../supabase/migrations', name), 'utf8')
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.profile', true), '')::uuid $$;
    create table profiles(id uuid primary key, role text, full_name text);
    create function public.get_my_role() returns text language sql stable security definer set search_path = ''
      as $$ select role from public.profiles where id = auth.uid() $$;
    create table students(id uuid primary key, profile_id uuid unique, is_active boolean);
    create table teachers(id uuid primary key, profile_id uuid);
    create table curators(id uuid primary key, profile_id uuid);
    create table courses(id uuid primary key, owner_id uuid, is_active boolean, is_template boolean);
    create table course_curators(course_id uuid, profile_id uuid);
    create table groups(id uuid primary key, course_id uuid, teacher_id uuid, curator_id uuid, is_active boolean);
    create table group_students(group_id uuid, student_id uuid);
    create table school_presence(profile_id uuid primary key, role text, seen_at timestamptz);
    create table app_visits(profile_id uuid, visited_on date, visited_at timestamptz, primary key(profile_id, visited_on));
    create table modules(id uuid, course_id uuid);
    create table topics(id uuid, module_id uuid, kind text, title text);
    create table topic_homework(id uuid, topic_id uuid);
    create table topic_homework_attempts(id uuid, homework_id uuid, student_id uuid, submitted_at timestamptz, status text);
    create function topic_done_events(uuid[]) returns table(student_id uuid, topic_id uuid, done_at timestamptz)
      language sql as $$ select null::uuid, null::uuid, null::timestamptz where false $$;

    insert into profiles values
      ('${id(1)}', 'teacher', 'Учитель'), ('${id(2)}', 'admin', 'Администратор'),
      ('${id(3)}', 'teacher', 'Другой учитель'),
      ('${id(10)}', 'student', 'Свой ученик'), ('${id(11)}', 'student', 'Соседняя группа'),
      ('${id(12)}', 'student', 'Чужой курс'), ('${id(13)}', 'student', 'Без заходов');
    insert into teachers values ('${id(21)}', '${id(1)}'), ('${id(23)}', '${id(3)}');
    insert into students values
      ('${id(110)}', '${id(10)}', true), ('${id(111)}', '${id(11)}', true),
      ('${id(112)}', '${id(12)}', true), ('${id(113)}', '${id(13)}', true);
    insert into courses values
      ('${id(31)}', '${id(3)}', true, false), ('${id(32)}', '${id(3)}', true, false);
    insert into groups values
      ('${id(41)}', '${id(31)}', '${id(21)}', null, true),
      ('${id(42)}', '${id(31)}', '${id(23)}', null, true),
      ('${id(43)}', '${id(32)}', '${id(23)}', null, true),
      ('${id(44)}', '${id(31)}', '${id(21)}', null, true);
    insert into group_students values
      ('${id(41)}', '${id(110)}'), ('${id(44)}', '${id(110)}'),
      ('${id(41)}', '${id(113)}'), ('${id(42)}', '${id(111)}'), ('${id(43)}', '${id(112)}');
    insert into school_presence select id, 'student', now() - interval '5 minutes' from profiles
      where id in ('${id(10)}', '${id(11)}', '${id(12)}');
    insert into app_visits select id, (now() at time zone 'Europe/Moscow')::date, now() from profiles
      where id in ('${id(10)}', '${id(11)}', '${id(12)}');
  `)
  await db.exec(migration('20260911214826_school_presence_touch_role_is_text.sql'))
  await db.exec(migration('20261125083803_teacher_activity_pulse.sql'))
  await db.exec(migration('20261125113855_teacher_student_activity_details.sql'))
  await db.exec(migration('20261125115038_teacher_homework_submissions_today.sql'))
  await db.exec(migration('20261127103713_teacher_activity_period.sql'))
}, 20_000)

afterAll(async () => { await db?.close() })

async function asAuthenticated<T>(profile: number, query: string) {
  await db.exec('set role authenticated')
  try {
    await db.query('select set_config(\'test.profile\', $1, false)', [id(profile)])
    return (await db.query<T>(query)).rows
  } finally {
    await db.exec('reset role')
  }
}

describe('teacher student activity SQL', () => {
  it('ограничивает список своими группами и убирает дубли', async () => {
    const rpc = 'select * from public.teacher_presence_online()'
    expect(await asAuthenticated(1, rpc)).toEqual([{ student_id: id(110), full_name: 'Свой ученик' }])
    expect(await asAuthenticated(2, rpc)).toEqual([])
    expect(await asAuthenticated(1, `select * from public.teacher_presence_online(array['${id(32)}'::uuid])`)).toEqual([])
    await expect(asAuthenticated(10, rpc)).rejects.toMatchObject({ code: '42501' })
    await expect(asAuthenticated(1, 'select * from teacher_analytics.student_roster(null)')).rejects.toMatchObject({ code: '42501' })
  })

  it('выдаёт семь дней, включает ученика без заходов и сверяет недельный итог', async () => {
    type Visit = { visited: boolean; first_visit_at: string | null; seconds: number | null }
    type Student = { student_id: string; days: Visit[] }
    const rpc = 'select public.teacher_student_visits() as visits'
    const [{ visits }] = await asAuthenticated<{ visits: Student[] }>(1, rpc)
    expect(visits.map(row => row.student_id).sort()).toEqual([id(110), id(113)])
    const own = visits.find(row => row.student_id === id(110))!
    expect(own.days).toHaveLength(7)
    expect(own.days[0]).toMatchObject({ visited: true, seconds: null })
    expect(own.days[0].first_visit_at).toBeTruthy()
    expect(visits.find(row => row.student_id === id(113))?.days.every(day => !day.visited)).toBe(true)
    const [{ pulse }] = await asAuthenticated<{ pulse: { enrolled: number; visited_week: number } }>(1, 'select public.teacher_activity_pulse() as pulse')
    expect(pulse).toMatchObject({ enrolled: 2, visited_week: 1 })
    await expect(asAuthenticated(10, rpc)).rejects.toMatchObject({ code: '42501' })
  })

  it('складывает только близкие отметки ученика и хранит время закрыто', async () => {
    await db.exec(`update school_presence set foreground_seen_at = now() - interval '60 seconds' where profile_id = '${id(10)}'`)
    await asAuthenticated(10, 'select public.school_presence_touch_with_time()')
    const total = async () => (await db.query<{ seconds: number }>(
      'select sum(seconds)::int as seconds from teacher_analytics.student_visit_time where profile_id = $1', [id(10)],
    )).rows[0].seconds
    const measured = await total()
    expect(measured).toBeGreaterThanOrEqual(58)
    expect(measured).toBeLessThanOrEqual(62)
    await db.exec(`update school_presence set foreground_seen_at = now() - interval '10 minutes' where profile_id = '${id(10)}'`)
    await asAuthenticated(10, 'select public.school_presence_touch_with_time()')
    expect(await total()).toBe(measured)
    await expect(asAuthenticated(1, 'select * from teacher_analytics.student_visit_time')).rejects.toMatchObject({ code: '42501' })
  })

  it('совпадает со счётчиком графика, соблюдает границы дня и видимость группы', async () => {
    await db.exec(`
      insert into modules values ('${id(50)}', '${id(31)}'), ('${id(51)}', '${id(32)}');
      insert into topics values
        ('${id(60)}', '${id(50)}', 'lesson', 'Тема домашней работы'),
        ('${id(61)}', '${id(50)}', 'control', 'Контрольная'),
        ('${id(62)}', '${id(51)}', 'lesson', 'Чужой курс');
      insert into topic_homework values ('${id(70)}', '${id(60)}'), ('${id(71)}', '${id(61)}'), ('${id(72)}', '${id(62)}');
      with bounds as (
        select date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow' as start
      )
      insert into topic_homework_attempts
      select attempts.* from bounds cross join lateral (values
        ('${id(80)}'::uuid, '${id(70)}'::uuid, '${id(110)}'::uuid, start, 'submitted'),
        ('${id(81)}', '${id(70)}', '${id(113)}', now(), 'returned'),
        ('${id(82)}', '${id(70)}', '${id(111)}', now(), 'submitted'),
        ('${id(83)}', '${id(72)}', '${id(112)}', now(), 'submitted'),
        ('${id(84)}', '${id(70)}', '${id(110)}', now(), 'draft'),
        ('${id(85)}', '${id(71)}', '${id(110)}', now(), 'submitted'),
        ('${id(86)}', '${id(70)}', '${id(110)}', start - interval '1 second', 'submitted')
      ) attempts;
    `)
    const [{ pulse }] = await asAuthenticated<{ pulse: { as_of: string; days: { submissions: number }[] } }>(
      1, 'select public.teacher_activity_pulse() as pulse',
    )
    const rpc = `select attempt_id, full_name, topic_title from public.teacher_homework_submissions_today(null, '${pulse.as_of}')`
    const rows = await asAuthenticated(1, rpc)
    expect(rows).toEqual([
      { attempt_id: id(81), full_name: 'Без заходов', topic_title: 'Тема домашней работы' },
      { attempt_id: id(80), full_name: 'Свой ученик', topic_title: 'Тема домашней работы' },
    ])
    expect(rows).toHaveLength(pulse.days.at(-1)!.submissions)
    await expect(asAuthenticated(10, rpc)).rejects.toMatchObject({ code: '42501' })
  })

  it('считает месяц по дням и год по месяцам только по разрешённым ученикам и курсам', async () => {
    await db.exec(`
      with bounds as (select (now() at time zone 'Europe/Moscow')::date as today)
      insert into app_visits
      select profile_id, today - days_ago, (today - days_ago)::timestamp at time zone 'Europe/Moscow'
      from bounds cross join (values
        ('${id(10)}'::uuid, 29), ('${id(10)}'::uuid, 200), ('${id(10)}'::uuid, 365),
        ('${id(11)}'::uuid, 29), ('${id(12)}'::uuid, 200)
      ) as events(profile_id, days_ago);
      insert into teacher_analytics.student_visit_time
      values ('${id(10)}', (now() at time zone 'Europe/Moscow')::date - 29, 60);

      insert into modules values ('${id(250)}', '${id(31)}'), ('${id(251)}', '${id(32)}');
      insert into topics values
        ('${id(260)}', '${id(250)}', 'lesson', 'ДЗ'), ('${id(261)}', '${id(251)}', 'lesson', 'Чужой курс');
      insert into topic_homework values ('${id(270)}', '${id(260)}'), ('${id(271)}', '${id(261)}');
      with bounds as (select (now() at time zone 'Europe/Moscow')::date as today)
      insert into topic_homework_attempts
      select attempt_id, homework_id, student_id, (today - days_ago)::timestamp at time zone 'Europe/Moscow', status
      from bounds cross join (values
        ('${id(280)}'::uuid, '${id(270)}'::uuid, '${id(110)}'::uuid, 29, 'accepted'),
        ('${id(281)}'::uuid, '${id(270)}'::uuid, '${id(110)}'::uuid, 200, 'submitted'),
        ('${id(282)}'::uuid, '${id(270)}'::uuid, '${id(111)}'::uuid, 29, 'submitted'),
        ('${id(283)}'::uuid, '${id(271)}'::uuid, '${id(110)}'::uuid, 29, 'submitted'),
        ('${id(284)}'::uuid, '${id(270)}'::uuid, '${id(110)}'::uuid, 29, 'draft'),
        ('${id(285)}'::uuid, '${id(270)}'::uuid, '${id(110)}'::uuid, 365, 'submitted')
      ) as attempts(attempt_id, homework_id, student_id, days_ago, status);
    `)

    type Period = { starts_on: string; ends_on: string; buckets: { day: string; visits: number; submissions: number }[] }
    const rpc = (days: number, scope = 'null') => `select public.teacher_activity_period(${scope}, ${days}) as period`
    const getPeriod = async (days: number) => (await asAuthenticated<{ period: Period }>(1, rpc(days)))[0].period
    const month = await getPeriod(30)
    expect(month.buckets).toHaveLength(30)
    expect(month.buckets[0]).toEqual({ day: month.starts_on, visits: 1, submissions: 1 })
    expect(month.buckets[1]).toMatchObject({ visits: 0, submissions: 0 })
    expect(month.buckets.at(-1)?.day).toBe(month.ends_on)
    expect(month.buckets.reduce((sum, bucket) => sum + bucket.visits, 0)).toBe(2)

    const year = await getPeriod(365)
    expect(year.buckets.every(bucket => bucket.day.endsWith('-01'))).toBe(true)
    expect(year.buckets.at(-1)?.day.slice(0, 7)).toBe(year.ends_on.slice(0, 7))
    expect(year.buckets.reduce((sum, bucket) => sum + bucket.visits, 0)).toBe(3)
    expect(year.buckets.reduce((sum, bucket) => sum + bucket.submissions, 0)
      - month.buckets.reduce((sum, bucket) => sum + bucket.submissions, 0)).toBe(1)
    const [{ period: foreign }] = await asAuthenticated<{ period: Period }>(1, rpc(365, `array['${id(32)}'::uuid]`))
    expect(foreign.buckets.every(bucket => bucket.visits === 0 && bucket.submissions === 0)).toBe(true)
    await expect(asAuthenticated(10, rpc(30))).rejects.toMatchObject({ code: '42501' })
    await expect(asAuthenticated(1, rpc(366))).rejects.toMatchObject({ code: '22023' })
  })
})
