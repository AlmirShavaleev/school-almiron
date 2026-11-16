import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../..')
const staged = process.env.PERFORMANCE_MIGRATION
const migration = staged
  ? path.resolve(root, staged)
  : path.join(root, 'supabase/migrations', readdirSync(path.join(root, 'supabase/migrations')).find(f => /^\d+_optimize_active_work_and_homework_reads\.sql$/.test(f))!)
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    grant usage on schema public, auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table students(id uuid primary key, profile_id uuid);
    create table courses(id uuid primary key, owner_id uuid);
    create table modules(id uuid primary key, course_id uuid);
    create table topics(id uuid primary key, module_id uuid, kind text, title text, is_open boolean, available_from timestamptz);
    create table groups(id uuid primary key, course_id uuid);
    create table group_students(group_id uuid, student_id uuid);
    create table student_courses(student_id uuid, course_id uuid, status text, expires_at timestamptz);
    create table topic_homework(id uuid primary key, topic_id uuid, is_published boolean, opens_at timestamptz, closes_at timestamptz);
    create table topic_homework_personal_windows(homework_id uuid, student_id uuid, opens_at timestamptz, closes_at timestamptz);
    create table topic_homework_attempts(id uuid primary key, homework_id uuid, student_id uuid, status text);
    create table mock_exams(id uuid primary key, group_id uuid, title text, starts_at timestamptz, duration_minutes int);
    create table mock_exam_sheets(mock_exam_id uuid, student_id uuid, submitted_at timestamptz);
    create function auth_student_id() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
      select id from students where profile_id=auth.uid() $$;
    create function course_is_staff(p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
      select p is not null and (current_setting('test.role',true)='admin'
        or exists(select 1 from courses where id=p and owner_id=auth.uid())) $$;
    create function topic_homework_can_manage(p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
      select course_is_staff(m.course_id) from topic_homework h join topics t on t.id=h.topic_id join modules m on m.id=t.module_id where h.id=p $$;
    create function staff_manageable_topics() returns uuid[] language sql stable security definer set search_path=public,pg_temp as $$
      select coalesce(array_agg(t.id),'{}'::uuid[]) from topics t join modules m on m.id=t.module_id where course_is_staff(m.course_id) $$;
    create function topic_homework_student_window(p_homework_id uuid,p_student_id uuid)
      returns table(opens_at timestamptz,closes_at timestamptz,personal boolean)
      language sql stable security definer set search_path=public,pg_temp as $$
      select case when w.homework_id is not null then w.opens_at else h.opens_at end,
             case when w.homework_id is not null then w.closes_at else h.closes_at end,
             w.homework_id is not null
      from topic_homework h left join topic_homework_personal_windows w on w.homework_id=h.id and w.student_id=p_student_id where h.id=p_homework_id $$;
    create function progress_open_by_student(uuid[],uuid[]) returns jsonb language plpgsql stable as $$
      begin
        if current_setting('test.fail_progress',true)='true' then raise exception 'UNNECESSARY_PROGRESS_SCAN'; end if;
        return coalesce(nullif(current_setting('test.progress',true),''),'{}')::jsonb;
      end $$;
    create function topic_open_with(p jsonb,k text,is_open boolean,available_from timestamptz)
      returns boolean language sql stable as $$
      select coalesce((p->>k)::boolean,is_open,available_from is null or available_from<=now()) $$;
    create function mock_exam_window(p uuid) returns table(starts_at timestamptz,ends_at timestamptz)
      language sql stable security definer set search_path=public,pg_temp as $$
      select starts_at, starts_at+make_interval(mins=>duration_minutes) from mock_exams where id=p $$;
    alter table topic_homework enable row level security;
    alter table topic_homework_attempts enable row level security;
    grant select on topic_homework,topic_homework_attempts to authenticated;
    create policy topic_homework_staff_select on topic_homework for select to authenticated
      using(topic_id=any((select staff_manageable_topics())::uuid[]));
    create policy topic_homework_student_select on topic_homework for select to authenticated
      using(is_published);
    create policy topic_homework_attempts_select on topic_homework_attempts for select to authenticated
      using(student_id=auth_student_id() or topic_homework_can_manage(homework_id));
  `)
  const original = readFileSync(path.join(root, 'src/test/sql/activeWorksBeforeOptimization.sql'), 'utf8')
  await db.exec(original.replace('public.student_active_works(', 'public.student_active_works_before('))
  await db.exec(original)
  await db.exec('revoke all on function student_active_works(uuid) from public, anon, authenticated; grant execute on function student_active_works(uuid) to service_role')
  await db.exec(readFileSync(migration, 'utf8'))
}, 60_000)
afterAll(async () => { await db?.close() })

async function reset() {
  await db.exec(`
    reset role;
    truncate students,courses,modules,topics,groups,group_students,student_courses,topic_homework,
      topic_homework_personal_windows,topic_homework_attempts,mock_exams,mock_exam_sheets;
    select set_config('test.fail_progress','false',false), set_config('test.progress','{}',false),
           set_config('test.role','student',false),set_config('test.uid','${U(1)}',false);
    insert into students values ('${U(1)}','${U(1)}'),('${U(2)}','${U(2)}');
    insert into courses values ('${U(10)}','${U(3)}'),('${U(11)}','${U(4)}');
    insert into modules values ('${U(20)}','${U(10)}'),('${U(21)}','${U(11)}');
    insert into topics values ('${U(30)}','${U(20)}','control','Control',true,null),
      ('${U(31)}','${U(21)}','check','Other course',true,null);
    insert into groups values ('${U(40)}','${U(10)}');
    insert into group_students values ('${U(40)}','${U(1)}');
    insert into topic_homework values ('${U(50)}','${U(30)}',true,now()-interval '1 hour',now()+interval '1 hour'),
      ('${U(51)}','${U(31)}',true,now()-interval '1 hour',now()+interval '1 hour');
  `)
}
async function works(fn = 'student_active_works', student: string | null = U(1)) {
  return (await db.query(`select * from ${fn}($1) order by kind,homework_id,mock_exam_id`, [student])).rows
}
async function same() {
  const actual = await works()
  expect(actual).toEqual(await works('student_active_works_before'))
  return actual
}

describe('active work read optimization', () => {
  it('preserves function privileges', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(`
      select has_function_privilege('authenticated','student_active_works(uuid)','execute') as allowed`)
    expect(rows[0].allowed).toBe(false)
  })
  it('keeps current timed work, drafts, and excludes other courses', async () => {
    await reset()
    expect(await same()).toHaveLength(1)
    await db.exec(`insert into topic_homework_attempts values ('${U(60)}','${U(50)}','${U(1)}','draft')`)
    expect(await same()).toHaveLength(1)
    await db.exec(`update topic_homework_attempts set status='submitted'`)
    expect(await same()).toHaveLength(0)
  })
  it('uses personal windows instead of the common deadline', async () => {
    await reset()
    await db.exec(`update topic_homework set closes_at=now()-interval '1 minute';
      insert into topic_homework_personal_windows values ('${U(50)}','${U(1)}',now()-interval '1 minute',now()+interval '1 hour')`)
    expect(await same()).toHaveLength(1)
    await db.exec(`update topic_homework set closes_at=now()+interval '1 hour';
      update topic_homework_personal_windows set closes_at=now()-interval '1 second'`)
    expect(await same()).toHaveLength(0)
  })
  it('keeps progress gates and checks publication and future windows', async () => {
    await reset()
    await db.query(`select set_config('test.progress',$1,false)`, [JSON.stringify({ [`${U(1)}:${U(30)}`]: false })])
    expect(await same()).toHaveLength(0)
    await db.exec(`select set_config('test.progress','{}',false); update topic_homework set is_published=false`)
    expect(await same()).toHaveLength(0)
    await db.exec(`update topic_homework set is_published=true,opens_at=now()+interval '1 day',closes_at=now()+interval '2 days'`)
    expect(await same()).toHaveLength(0)
  })
  it('keeps active/trial course access and rejects expired access', async () => {
    await reset()
    await db.exec(`delete from group_students; insert into student_courses values ('${U(1)}','${U(10)}','trial',now()+interval '1 day')`)
    expect(await same()).toHaveLength(1)
    await db.exec(`update student_courses set expires_at=now()-interval '1 second'`)
    expect(await same()).toHaveLength(0)
  })
  it('skips progress entirely for no candidate, null student, and staff', async () => {
    await reset()
    await db.exec(`update topic_homework set closes_at=now()-interval '1 second'; select set_config('test.fail_progress','true',false)`)
    expect(await works()).toHaveLength(0)
    expect(await works('student_active_works', null)).toHaveLength(0)
    expect(await works('student_active_works', U(99))).toHaveLength(0)
  })
  it('still detects a mock exam without calculating timed-work progress', async () => {
    await reset()
    await db.exec(`update topic_homework set is_published=false;
      insert into mock_exams values ('${U(70)}','${U(40)}','Mock',now()-interval '10 minutes',60)`)
    expect(await same()).toHaveLength(1)
    await db.exec(`select set_config('test.fail_progress','true',false)`)
    expect(await works()).toHaveLength(1)
    await db.exec(`insert into mock_exam_sheets values ('${U(70)}','${U(1)}',now())`)
    expect(await works()).toHaveLength(0)
  })
})

describe('homework attempt RLS', () => {
  it('matches the previous predicate for students, course staff, admin, and missing profile', async () => {
    await reset()
    await db.exec(`insert into topic_homework_attempts values
      ('${U(60)}','${U(50)}','${U(1)}','submitted'),
      ('${U(61)}','${U(50)}','${U(2)}','submitted'),
      ('${U(62)}','${U(51)}','${U(2)}','submitted');
      create temporary table expected_attempts(id uuid);
      grant select on expected_attempts to authenticated;`)
    for (const [uid, role, count] of [[U(1),'student',1],[U(2),'student',2],[U(3),'teacher',2],
      [U(4),'curator',1],[U(5),'admin',3],[U(99),'student',0],['','student',0]] as const) {
      await db.exec(`reset role; select set_config('test.uid','${uid}',false),set_config('test.role','${role}',false);
        truncate expected_attempts;
        insert into expected_attempts select id from topic_homework_attempts
          where student_id=auth_student_id() or topic_homework_can_manage(homework_id);
        set role authenticated;`)
      const actual = (await db.query('select id from topic_homework_attempts order by id')).rows
      const expected = (await db.query('select id from expected_attempts order by id')).rows
      expect(actual, role).toEqual(expected)
      expect(actual, role).toHaveLength(count)
    }
    await db.exec('reset role')
  })
})
