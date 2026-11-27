import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.profile', true), '')::uuid $$;
    create table public.groups(id uuid primary key, course_id uuid);
    create table public.students(id uuid primary key, profile_id uuid not null);
    create table public.group_students(group_id uuid, student_id uuid);
    create table public.mock_exams(
      id uuid primary key default gen_random_uuid(), group_id uuid, title text, subject text, exam_type text,
      date timestamptz, starts_at timestamptz, duration_minutes smallint, photo_grace_minutes smallint default 15,
      template_id uuid, max_score int, created_by uuid, variant_mode text, module_id uuid, module_position int
    );
    create table public.mock_exam_task_scores(mock_exam_id uuid, student_id uuid);
    create table public.mock_exam_sheets(mock_exam_id uuid, student_id uuid, submitted_at timestamptz, answers text[]);
    create table public.mock_exam_photos(mock_exam_id uuid, student_id uuid);
    create table public.mock_exam_results(mock_exam_id uuid, student_id uuid, notified_at timestamptz, score int);
    create table public.mock_exam_variant_students(mock_exam_id uuid, student_id uuid);
    create table public.subscription_tariffs(course_id uuid);
    create type public.notification_queue_status as enum ('pending', 'cancelled', 'sent');
    create table public.notification_queue(
      profile_id uuid, channel text, event_type text, entity_type text, entity_id uuid, deduplication_key text unique,
      payload jsonb, status public.notification_queue_status, scheduled_for timestamptz, attempts integer default 0
    );
    create function public.is_admin_or_owner() returns boolean language sql stable as $$ select false $$;
    create function public.auth_student_id() returns uuid language sql stable security definer as
      $$ select id from public.students where profile_id = auth.uid() $$;
    create function public.mock_exam_group_can_manage(g uuid) returns boolean language sql stable as
      $$ select auth.uid() = '${id(1)}' and g in ('${id(10)}', '${id(11)}') $$;
    create function public.mock_exam_group_is_staff(g uuid) returns boolean language sql stable as
      $$ select public.mock_exam_group_can_manage(g) $$;
    create function public.mock_exam_is_staff(exam uuid) returns boolean language sql stable security definer as
      $$ select public.mock_exam_group_is_staff(group_id) from public.mock_exams where id = exam $$;
    create function public.mock_exam_is_my_teacher(t uuid) returns boolean language sql stable as $$ select false $$;
    create function public.subscription_access_ok(uuid, uuid) returns boolean language sql stable as $$ select true $$;
    create function public.mock_exam_window(exam uuid)
      returns table(starts_at timestamptz, ends_at timestamptz, photos_until timestamptz)
      language sql stable security definer as $$
        select e.starts_at, e.starts_at + interval '4 hours', e.starts_at + interval '4 hours 15 minutes'
        from public.mock_exams e where e.id = exam;
      $$;
    alter table public.mock_exams enable row level security;
    grant select on public.mock_exams to authenticated;
    grant usage on schema auth to authenticated;
    create policy mock_exams_select on public.mock_exams for select using (true);

    insert into public.groups values ('${id(10)}', '${id(30)}'), ('${id(11)}', '${id(30)}'), ('${id(12)}', '${id(31)}');
    insert into public.students values ('${id(101)}', '${id(201)}'), ('${id(102)}', '${id(202)}'), ('${id(103)}', '${id(203)}');
    insert into public.group_students values
      ('${id(10)}', '${id(101)}'), ('${id(10)}', '${id(102)}'), ('${id(11)}', '${id(102)}'),
      ('${id(11)}', '${id(103)}'), ('${id(12)}', '${id(103)}');
    insert into public.mock_exams(id, group_id, title, starts_at) values ('${id(50)}', '${id(10)}', 'Legacy', now() + interval '2 days');
    set check_function_bodies = off;
  `)
  await db.exec(readFileSync(path.resolve(import.meta.dirname, '../../../supabase/migrations/20261126083806_mock_exam_participant_rosters.sql'), 'utf8'))
  await db.exec(`
    reset check_function_bodies;
    create trigger mock_exams_schedule_notifications
      after insert or delete or update of starts_at, duration_minutes, photo_grace_minutes, group_id, title on public.mock_exams
      for each row execute function public.mock_exam_schedule_notifications();
  `)
}, 20_000)

afterAll(async () => db?.close())

async function asProfile<T>(profile: number, sql: string, params: unknown[] = []) {
  await db.exec('set role authenticated')
  try {
    await db.query("select set_config('test.profile', $1, false)", [id(profile)])
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

function exam(group: number, students: number[], startsAt: string | null = '2099-05-06T07:00:00Z') {
  return {
    title: 'Новый', group_id: id(group), student_ids: students.map(id), starts_at: startsAt,
    date: '2099-05-06T07:00:00Z', duration_minutes: 235, max_score: 100, variant_mode: 'order',
  }
}

const create = (profile: number, exams: ReturnType<typeof exam>[]) =>
  asProfile<{ id: string; group_id: string }>(profile, 'select * from public.create_mock_exams_for_participants($1::jsonb)', [JSON.stringify(exams)])

async function reminders(examId: string) {
  const { rows } = await db.query<{ profile_id: string }>(
    "select distinct profile_id from public.notification_queue where entity_id = $1 and status = 'pending' order by profile_id", [examId],
  )
  return rows.map(row => row.profile_id)
}

describe('назначение пробника по списку участников', () => {
  it('назначает только выбранным, скрывает состав от учеников и сохраняет доступ к старому пробнику', async () => {
    const [first, second] = await create(1, [exam(10, [101]), exam(11, [103])])
    expect(await reminders(first.id)).toEqual([id(201)])
    expect(await reminders(second.id)).toEqual([id(203)])
    const visible = 'select id from public.mock_exams where id = $1'
    expect(await asProfile(201, visible, [first.id])).toHaveLength(1)
    expect(await asProfile(202, visible, [first.id])).toEqual([])
    expect(await asProfile(202, visible, [id(50)])).toHaveLength(1)
    expect(await asProfile(201, 'select student_ids from public.mock_exam_rosters where mock_exam_id = $1', [first.id])).toEqual([])
    expect(await asProfile(202, 'select public.mock_exam_my_student_id($1) as student_id', [first.id])).toEqual([{ student_id: null }])
    const list = 'select public.my_mock_exams($1) as exams'
    const [shown] = await asProfile<{ exams: { id: string }[] }>(201, list, [id(10)])
    const [hidden] = await asProfile<{ exams: { id: string }[] }>(202, list, [id(10)])
    expect(shown.exams.map(item => item.id)).toContain(first.id)
    expect(hidden.exams.map(item => item.id)).toEqual([id(50)])
  })

  it('меняет будущий список и получателей напоминаний без переноса времени', async () => {
    const [row] = await create(1, [exam(10, [101])])
    await asProfile(1, "select public.save_mock_exam_participant_settings($1, '{}'::jsonb, $2::uuid[])", [row.id, [id(102)]])
    expect(await reminders(row.id)).toEqual([id(202)])
    expect(await asProfile(201, 'select id from public.mock_exams where id = $1', [row.id])).toEqual([])
    expect(await asProfile(202, 'select id from public.mock_exams where id = $1', [row.id])).toHaveLength(1)
  })

  it('сохраняет черновик скрытым и отклоняет чужие группы, учеников и дубли без частичных записей', async () => {
    const [draft] = await create(1, [exam(10, [101], null)])
    expect(await reminders(draft.id)).toEqual([])
    expect(await asProfile(201, 'select id from public.mock_exams where id = $1', [draft.id])).toEqual([])
    const before = await db.query('select count(*) from public.mock_exams')
    await expect(create(1, [exam(10, [101]), exam(12, [103])])).rejects.toThrow('Нет доступа')
    await expect(create(1, [exam(10, [103])])).rejects.toThrow('Состав группы')
    await expect(create(1, [exam(10, [102]), exam(11, [102])])).rejects.toThrow('только в одной группе')
    await expect(create(201, [exam(10, [101])])).rejects.toThrow('Нет доступа')
    expect((await db.query('select count(*) from public.mock_exams')).rows).toEqual(before.rows)
  })
})
