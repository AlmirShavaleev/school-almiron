import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, STUBS, migrationFiles } from '@/test/sql/migrationChain'
import type { PlanInput, PlanItemInput, WorkPlanRead } from '@/lib/studentWorkPlan'

const scenario = [
  ['cf9472ad-fe30-4803-bee3-b0b1db558c7b', 'Рациональные уравнения', 6, 12, '2026-11-27'],
  ['c4affb86-90fa-4b66-abf7-878ab5ea8593', 'Иррациональные уравнения', 6, 10, '2026-11-28'],
  ['6eb5aafd-f61e-4f63-aab6-59b09094cb47', 'Рациональные выражения', 7, 12, '2026-11-29'],
  ['380a486d-3f04-4ece-b5c0-d6696929ffe4', 'Иррациональные выражения', 7, 12, '2026-11-30'],
  ['c44e11cb-0d14-48c5-9cdb-280e32abcc39', 'Действия со степенями', 7, 12, '2026-12-01'],
  ['68fb548e-8fba-4b88-baff-544b97f0e1ed', 'Задачи на движение по прямой', 10, 12, '2026-12-02'],
  ['566d9a49-a1c0-42de-b30d-e1a46c7a2871', 'Движение по окружности', 10, 10, '2026-12-03'],
] as const
const course = 'd74b1a0a-4833-405a-9938-ec9844ffa2d8'
const teacher = randomUUID()
const otherTeacher = randomUUID()
const pupil = randomUUID()
const classmate = randomUUID()
const outsider = randomUUID()
let db: PGlite
let ids: { pupil: string; classmate: string; outsider: string; group: string; module: string }
let taskIds: string[] = []
let originalHomeSql = ''
const workPlanReplacedFunctions = [
  'public._progress_state(uuid,uuid[])',
  'public.student_home_courses()',
  'public.topic_homework_attempts_guard()',
]
let workPlanOriginalFunctions: string[]

function functionDefinition(signature: string) {
  return scalar<string>('select pg_get_functiondef($1::regprocedure) as value', [signature])
}

async function as(uid: string | null, role: 'authenticated' | 'anon' | 'postgres' = 'authenticated') {
  await db.exec(role === 'postgres' ? 'reset role' : `set role ${role}`)
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ''])
}

async function scalar<T>(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ value: T }>(sql, params)
  return rows[0]?.value
}

function plan(items: Partial<PlanInput> = {}): PlanInput {
  return {
    id: randomUUID(), student_id: ids.pupil, title: 'Персональный план на неделю',
    starts_on: '2026-11-27', ends_on: '2026-12-03', daily_minutes: 60,
    course_ids: [course], rest_days: [], note: '', status: 'draft', notify: false, ...items,
  }
}

function item(topicId = scenario[0][0] as string, patch: Partial<PlanItemInput> = {}): PlanItemInput {
  return {
    id: randomUUID(), topic_id: topicId, scheduled_on: '2026-11-27', due_on: '2026-11-27',
    position: 0, minutes: 60, criterion: 'task_count', target_tasks: 1,
    task_ids: [], required: true, note: '', access_mode: 'keep', repeat: false, ...patch,
  }
}

function save(p: PlanInput, items: PlanItemInput[], revision: number | null = null, request = randomUUID()) {
  return scalar<{ id: string; revision: number }>('select student_work_plan_save($1::jsonb,$2::jsonb,$3,$4) as value',
    [JSON.stringify(p), JSON.stringify(items), request, revision])
}

function read(view: string, id: string | null = null) {
  return scalar<WorkPlanRead>('select student_work_plan_read($1,$2) as value', [view, id])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  for (const f of migrationFiles()) await db.exec(readFileSync(f, 'utf8'))
  await db.exec(`
    alter table public.students add column if not exists is_active boolean default true;
    alter table public.groups add column if not exists is_active boolean default true;
    alter table public.courses add column if not exists is_active boolean default true;
    alter table public.courses add column if not exists is_draft boolean default false;
    alter table public.topics add column if not exists kind text default 'lesson';
    alter table public.topics add column if not exists ege_task_numbers smallint[] default '{}';
    alter table public.topic_homework add column if not exists title text default 'Домашнее задание';
    alter table public.topic_homework_attempts add column if not exists submitted_at timestamptz;
    alter table public.topic_homework_attempts add column if not exists updated_at timestamptz default now();
    alter table public.topic_homework_attempts add column if not exists auto_submitted boolean default false;
    alter table public.topic_autocheck_tasks add column if not exists code text default '1';
    alter table public.topic_autocheck_tasks add column if not exists position int default 0;
    alter table public.topic_autocheck_tasks add column if not exists statement_path text;
    alter table public.topic_autocheck_tasks add column if not exists statement_md text;
    alter table public.topic_autocheck_tasks add column if not exists answer_type text default 'number';
    alter table public.topic_autocheck_tasks add column if not exists answer_value numeric default 1;
    alter table public.topic_autocheck_tasks add column if not exists answer_tol numeric default 0;
    alter table public.topic_autocheck_tasks add column if not exists answer_text text;
    alter table public.topic_autocheck_tasks add column if not exists digits_any_order boolean default false;
    alter table public.topic_autocheck_tasks add column if not exists unit text;
    alter table public.topic_material_items add column if not exists kind text default 'link';
    alter table public.topic_material_items add column if not exists url text;
    create index if not exists topic_autocheck_tasks_topic_idx on public.topic_autocheck_tasks(topic_id,position);
    create index if not exists topic_autocheck_answers_profile_idx on public.topic_autocheck_answers(profile_id,task_id);
    create table public.video_watch_daily (student_id uuid,item_id uuid,day date,seconds int,max_position int,
      duration_seconds int,updated_at timestamptz,primary key(student_id,item_id,day));
    create table public.notification_prefs (user_id uuid primary key, homework boolean default true, overdue boolean default true,
      telegram boolean default true, remind_hw_due_tomorrow boolean default true, remind_hw_overdue boolean default true);
    create function public.course_is_admin() returns boolean language sql stable as $$ select public.is_admin_or_owner() $$;
    create function public.auth_is_staff_of_student(p uuid) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.group_students gs join public.groups g on g.id=gs.group_id
                    where gs.student_id=p and public.course_is_staff(g.course_id)) $$;
    create function public._topic_homework_course_staff(p_course uuid) returns table (profile_id uuid)
      language sql stable as $$ select c.owner_id from public.courses c where c.id=p_course $$;
    create function public.topic_homework_is_timed(p uuid) returns boolean language sql stable as $$
      select exists (select 1 from public.topic_homework h join public.topics t on t.id=h.topic_id
                      where h.id=p and t.kind in ('check','control')) $$;
    create function public.topic_homework_window_open(p uuid,s uuid) returns boolean language sql stable as $$ select false $$;
    create function public.topic_homework_window_message(p uuid,s uuid) returns text language sql stable as $$ select 'Окно закрыто' $$;
    create function public.normalize_variant_answer(s text) returns text language sql immutable as $$ select replace(trim(s), ',', '.') $$;
    create function cron.unschedule(n text) returns boolean language sql as $$
      with deleted as (delete from cron.job where jobname = n returning 1)
      select exists (select 1 from deleted)
    $$;
    create or replace function cron.schedule(n text, s text, c text) returns int language sql as $$
      insert into cron.job (jobname, schedule, command) values (n, s, c)
      on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid
    $$;
  `)
  const guard = readFileSync(path.join(MIGRATIONS, '20260928122420_kontrolnaya_timed_work.sql'), 'utf8').replace(/\r/g, '')
  await db.exec(guard.match(/create or replace function public\.topic_homework_attempts_guard\(\)[\s\S]*?end \$\$;/)![0])
  await db.exec(`create trigger test_homework_guard before insert or update or delete on public.topic_homework_attempts
                 for each row execute function public.topic_homework_attempts_guard()`)
  const autocheck = readFileSync(path.join(MIGRATIONS, '20261005213414_trenirovochnye_uroki_sravnenie_otveta.sql'), 'utf8')
  await db.exec(autocheck.split('create or replace function public.topic_autocheck_task_topic')[0])
  const openStates = readFileSync(path.join(MIGRATIONS, '20261013081000_288_1_open_states.sql'), 'utf8')
  for (const name of ['progress_open_by_student', 'topic_open_with']) {
    const sql = openStates.match(new RegExp('create (?:or replace )?function public\\.' + name + '\\([\\s\\S]*?\\$\\$;', 'i'))
    if (!sql) throw new Error('Не найдена функция ворот ' + name)
    await db.exec(sql[0])
  }
  const progression = readFileSync(path.join(MIGRATIONS, '20261116234836_cache_inner_read_query_plans.sql'), 'utf8')
  await db.exec(progression.match(/CREATE OR REPLACE FUNCTION public\._progress_state[\s\S]*?\$function\$;/)![0])
  await db.exec(readFileSync(path.join(MIGRATIONS, '20261013214307_student_home_courses.sql'), 'utf8'))
  originalHomeSql = await scalar<string>("select prosrc as value from pg_proc where oid='public.student_home_courses()'::regprocedure")
  workPlanOriginalFunctions = await Promise.all(workPlanReplacedFunctions.map(functionDefinition))
  await db.exec(readFileSync(path.join(MIGRATIONS, '20261126214358_student_work_plans.sql'), 'utf8'))
  const noticesMigration = readdirSync(MIGRATIONS).find(file => file.endsWith('_student_work_plan_notices.sql'))
  if (!noticesMigration) throw new Error('Не найдена миграция уведомлений планов')
  await db.exec(readFileSync(path.join(MIGRATIONS, noticesMigration), 'utf8'))

  for (const [id, name, role] of [[teacher,'Преподаватель','teacher'],[otherTeacher,'Другой преподаватель','teacher'],
    [pupil,'Тестовый ученик','student'],[classmate,'Одноклассник','student'],[outsider,'Чужой ученик','student']]) {
    await db.query('insert into profiles(id, full_name, role) values ($1,$2,$3)', [id, name, role])
  }
  await db.query("insert into courses(id,title,owner_id) values ($1,'ЕГЭ. Математика 1 часть — 11А',$2)", [course, teacher])
  ids = {
    pupil: await scalar("insert into students(profile_id) values ($1) returning id as value", [pupil]),
    classmate: await scalar("insert into students(profile_id) values ($1) returning id as value", [classmate]),
    outsider: await scalar("insert into students(profile_id) values ($1) returning id as value", [outsider]),
    group: await scalar("insert into groups(course_id,name) values ($1,'11А') returning id as value", [course]),
    module: await scalar("insert into modules(course_id,title) values ($1,'Задачи ЕГЭ') returning id as value", [course]),
  }
  for (const id of [ids.pupil, ids.classmate]) {
    await db.query('insert into group_students(group_id,student_id) values ($1,$2)', [ids.group, id])
  }
  for (const [position, [id, title, ege, count]] of scenario.entries()) {
    await db.query('insert into topics(id,module_id,title,ege_task_numbers,order_index) values ($1,$2,$3,$4,$5)',
      [id, ids.module, title, [ege], position])
    const { rows } = await db.query<{ id: string }>(
      'insert into topic_autocheck_tasks(topic_id,code,position,statement_md) select $1,i::text,i,\'Задача\' from generate_series(1,$2::int) i returning id',
      [id, count],
    )
    if (position === 0) taskIds = rows.map(r => r.id)
  }
  await db.query("insert into telegram_connections(profile_id,telegram_chat_id) values ($1,1)", [pupil])
})

afterAll(async () => { await db?.close() })

describe('Персональный план в PostgreSQL', () => {
  it('сохраняет пример на 7 дней, допускает правку, публикует ровно одно событие и не раскрывает черновик', async () => {
    const draft = plan({ notify: true })
    const items = scenario.map(([id, , , count, day]) => item(id, { scheduled_on: day, due_on: day, target_tasks: count }))
    await as(teacher)
    expect(await save(draft, items)).toMatchObject({ revision: 1 })
    await as(pupil)
    expect((await read('detail', draft.id)).plans).toEqual([])
    await expect(db.query('select * from student_work_plans')).rejects.toThrow(/permission denied/)
    await expect(save({ ...draft, status: 'published' }, items, 1)).rejects.toThrow(/Нет доступа/)
    await as(otherTeacher)
    expect((await read('staff_detail', draft.id)).plans).toEqual([])
    await expect(save({ ...draft, status: 'published' }, items, 1)).rejects.toThrow(/Нет доступа/)
    await as(teacher)
    const request = randomUUID()
    expect(await save({ ...draft, status: 'published' }, items, 1, request)).toMatchObject({ revision: 2 })
    expect(await save({ ...draft, status: 'published' }, items, 1, request)).toMatchObject({ revision: 2 })
    await expect(save({ ...draft, status: 'published' }, items, 1)).rejects.toThrow(/План уже изменился/)
    await as(pupil)
    const result = (await read('detail', draft.id)).plans[0]
    expect(result).toMatchObject({ total: 7, minutes: 420, remaining_tasks: 80 })
    expect(result.items.map(i => [i.topic_id, i.scheduled_on, i.group_id])).toEqual(scenario.map(([id, , , , day]) => [id, day, ids.group]))
    await as(classmate)
    expect((await read('detail', draft.id)).plans).toEqual([])
    await as(pupil, 'anon')
    await expect(read('detail', draft.id)).rejects.toThrow(/permission denied/)
    await as(null, 'postgres')
    expect(await scalar('select count(*)::int as value from notifications where dedup_key like $1', [`work-plan:${draft.id}:%`])).toBe(1)
    expect(await scalar('select count(*)::int as value from notification_queue where entity_id=$1', [draft.id])).toBe(1)
  })

  it('засчитывает уникальные верные задачи, различает сдачу в срок и позднее и отделяет повторение', async () => {
    const regular = plan({ status: 'published' })
    const regularItem = item(scenario[0][0], { criterion: 'specific_tasks', task_ids: taskIds.slice(0, 2) })
    const repeat = plan({ status: 'published' })
    const repeatItem = item(scenario[0][0], { criterion: 'specific_tasks', task_ids: taskIds.slice(0, 2), repeat: true })
    await as(teacher)
    await save(regular, [regularItem])
    await save(repeat, [repeatItem])
    await as(null, 'postgres')
    await db.query(`insert into topic_autocheck_answers(task_id,profile_id,attempt_no,answer_raw,is_correct,created_at)
      values ($1,$4,1,'1',true,'2026-11-27 10:00+03'),($1,$4,2,'1',true,'2026-11-27 11:00+03'),
             ($2,$4,1,'0',false,'2026-11-27 11:00+03'),($3,$4,1,'1',true,'2026-11-27 11:00+03')`,
      [...taskIds.slice(0, 3), pupil])
    await as(pupil)
    expect((await read('detail', regular.id)).plans[0].items[0]).toMatchObject({ solved: 1, completed_at: null, target: 2, task_codes: ['1','2'] })
    expect((await read('detail', repeat.id)).plans[0].solved).toBe(0)
    await expect(scalar('select student_work_plan_repeat_check($1,$2,$3) as value', [repeatItem.id, taskIds[2], '1'])).rejects.toThrow(/Повторение недоступно/)
    expect(await scalar('select student_work_plan_repeat_check($1,$2,$3) as value', [repeatItem.id, taskIds[0], '1'])).toMatchObject({ correct: true })
    await expect(scalar('select student_work_plan_repeat_check($1,$2,$3) as value', [repeatItem.id, taskIds[0], '1'])).rejects.toThrow(/AUTOCHECK_CLOSED/)
    expect((await read('detail', repeat.id)).plans[0].solved).toBe(1)
    await as(null, 'postgres')
    await db.query(`insert into topic_autocheck_answers(task_id,profile_id,attempt_no,answer_raw,is_correct,created_at)
      values ($1,$2,2,'1',true,'2026-11-28 00:01+03')`, [taskIds[1], pupil])
    const proof = await scalar<{ state: string; solved: number }>(
      "select to_jsonb(t) as value from _work_plan_progress(array[$1::uuid], '2026-11-29') t", [regular.id])
    expect(proof).toMatchObject({ state: 'late', solved: 2, first_correct: 1, attempted: 2 })
    await as(classmate)
    await expect(scalar('select student_work_plan_repeat_tasks($1,$2) as value', [repeatItem.id, scenario[0][0]])).rejects.toThrow(/Повторение недоступно/)
  })

  it('использует индивидуальное открытие только у адресата и учитывает просрочку независимо от курса', async () => {
    const topic = scenario[5][0]
    await as(null, 'postgres')
    await db.query("insert into course_unlock_modes(course_id,mode) values ($1,'progress')", [course])
    const future = plan({ starts_on: '2099-01-01', ends_on: '2099-01-07', status: 'published' })
    await as(teacher)
    await save(future, [item(topic, { scheduled_on: '2099-01-02', due_on: '2099-01-03', access_mode: 'scheduled' })])
    await as(pupil)
    expect(await scalar('select course_student_can_see_topic($1) as value', [topic])).toBe(false)
    const scheduled = plan({ starts_on: '2020-01-01', ends_on: '2020-01-07', status: 'published' })
    const assignment = item(topic, { scheduled_on: '2020-01-02', due_on: '2020-01-03', access_mode: 'scheduled' })
    await as(teacher)
    await save(scheduled, [assignment])
    await as(pupil)
    expect(await scalar('select course_student_can_see_topic($1) as value', [topic])).toBe(true)
    expect((await read('detail', scheduled.id)).plans[0].items[0]).toMatchObject({ progress_state: 'overdue', available: true })
    await as(classmate)
    expect(await scalar('select course_student_can_see_topic($1) as value', [topic])).toBe(false)
    await as(null, 'postgres')
    await db.query("insert into student_topic_overrides(student_id,topic_id,state) values ($1,$2,'closed')", [ids.pupil, topic])
    await as(pupil)
    expect((await read('detail', scheduled.id)).plans[0].items[0].available).toBe(false)
    await as(null, 'postgres')
    await db.query('delete from student_topic_overrides where student_id=$1 and topic_id=$2', [ids.pupil, topic])
    await db.query('delete from course_unlock_modes where course_id=$1', [course])
  })

  it('блокирует просроченный доступ, копирует отдельные планы и проверяет независимость дедлайна', async () => {
    const source = plan()
    const one = item()
    await as(teacher)
    await save(source, [one])
    const args = [source.id, '2026-12-04', randomUUID(), [ids.classmate, ids.outsider]]
    const result = await scalar<{ created: string[]; failed: { student_id: string }[] }>(
      'select student_work_plan_copy($1,$2,$3,$4) as value', args)
    expect(result.created).toHaveLength(1)
    expect(result.failed).toEqual([expect.objectContaining({ student_id: ids.outsider })])
    expect(await scalar('select student_work_plan_copy($1,$2,$3,$4) as value', args)).toEqual(result)
    const copy = (await read('staff_detail', result.created[0])).plans[0]
    expect(copy.student_id).toBe(ids.classmate)
    expect(copy.items[0].due_on).toBe('2026-12-04')
    expect((await read('staff_detail', source.id)).plans[0].items[0].due_on).toBe('2026-11-27')
    expect(await save(source, [{ ...one, due_on: '2026-12-06' }], 1)).toMatchObject({ revision: 2 })
    expect((await read('staff_detail', source.id)).plans[0]).toMatchObject({
      ends_on: '2026-12-03', effective_until: '2026-12-06',
    })
    expect((await read('staff_detail', result.created[0])).plans[0].items[0].due_on).toBe('2026-12-04')
    const template = await scalar<{ created: string[] }>(
      'select student_work_plan_copy($1,$2,$3,p_template => true) as value',
      [source.id, '2026-12-04', randomUUID()],
    )
    expect((await read('staff_detail', template.created[0])).plans[0]).toMatchObject({
      status: 'template', student_id: null,
    })
    const group = await scalar<{ created: string[]; failed: unknown[] }>(
      'select student_work_plan_copy($1,$2,$3,p_group_id => $4) as value',
      [template.created[0], '2026-12-11', randomUUID(), ids.group],
    )
    expect(group.failed).toEqual([])
    const groupCopies = []
    for (const id of group.created) groupCopies.push((await read('staff_detail', id)).plans[0])
    expect(new Set(groupCopies.map(p => p.student_id))).toEqual(new Set([ids.pupil, ids.classmate]))
    expect(new Set(groupCopies.map(p => p.items[0].id)).size).toBe(2)
    const live = plan({ status: 'published' })
    await save(live, [item()])
    await as(null, 'postgres')
    await db.query("update groups set is_active=false where id=$1", [ids.group])
    await as(pupil)
    expect((await read('detail', live.id)).plans[0].items[0]).toMatchObject({ available: false, group_id: null })
    await as(null, 'postgres')
    await db.query("update groups set is_active=true where id=$1", [ids.group])
    const tariff = await scalar<string>("insert into subscription_tariffs(course_id,title,price_rub) values ($1,'Тестовый тариф',100) returning id as value", [course])
    await db.query(`insert into student_subscriptions(student_id,course_id,tariff_id,status,access_until)
       values ($1,$2,$3,'expired',now() - interval '1 day')`, [ids.pupil, course, tariff])
    await as(pupil)
    expect((await read('detail', live.id)).plans[0].items[0]).toMatchObject({ available: false, group_id: null })
    await as(null, 'postgres')
    await db.query('delete from student_subscriptions where tariff_id=$1', [tariff])
    await db.query('delete from subscription_tariffs where id=$1', [tariff])
  })

  it('считает отправленное обычное ДЗ ожидающим проверки и сохраняет старую попытку при повторении', async () => {
    const topic = scenario[1][0]
    await as(null, 'postgres')
    const homework = await scalar<string>('insert into topic_homework(topic_id) values ($1) returning id as value', [topic])
    const original = await scalar<string>('insert into topic_homework_attempts(homework_id,student_id) values ($1,$2) returning id as value', [homework, ids.pupil])
    await db.query("update topic_homework_attempts set status='accepted', submitted_at='2026-11-27 10:00+03' where id=$1", [original])
    const repeat = plan({ status: 'published' })
    const assignment = item(topic, { criterion: 'homework', repeat: true, target_tasks: null })
    await as(teacher)
    await save(repeat, [assignment])
    await as(pupil)
    expect((await read('detail', repeat.id)).plans[0].done).toBe(0)
    expect(await scalar('select student_work_plan_repeat_homework_ids($1,$2) as value', [assignment.id, homework])).toEqual([])
    const next = await scalar<string>('select student_work_plan_repeat_homework_start($1,$2) as value', [assignment.id, homework])
    expect(next).not.toBe(original)
    expect(await scalar('select student_work_plan_repeat_homework_start($1,$2) as value', [assignment.id, homework])).toBe(next)
    await as(null, 'postgres')
    expect(await scalar('select status as value from topic_homework_attempts where id=$1', [original])).toBe('accepted')
    await expect(db.query('insert into topic_homework_attempts(homework_id,student_id) values ($1,$2)', [homework, ids.pupil]))
      .rejects.toThrow(/Работа уже принята/)
    await db.query("update topic_homework_attempts set status='submitted' where id=$1", [next])
    await as(pupil)
    expect((await read('detail', repeat.id)).plans[0].items[0].progress_state).toBe('review')
    await as(null, 'postgres')
    await db.query("update topic_homework_attempts set status='accepted' where id=$1", [next])
    await as(pupil)
    expect((await read('detail', repeat.id)).plans[0].items[0].completed_at).toBeTruthy()
  })

  it('засчитывает учебное видео по просмотру и оставляет удалённую тему в плане без ссылки', async () => {
    await as(null, 'postgres')
    const topic = await scalar<string>("insert into topics(module_id,title,is_open) values ($1,'Учебное видео',true) returning id as value", [ids.module])
    const video = await scalar<string>(`insert into topic_material_items(topic_id,section,kind,url)
      values ($1,'theory','video','https://iframe.mediadelivery.net/embed/1/example') returning id as value`, [topic])
    const p = plan({ status: 'published' })
    await as(teacher)
    await save(p, [item(topic, { criterion: 'theory', target_tasks: null })])
    await as(null, 'postgres')
    await db.query(`insert into video_watch_daily values ($1,$2,'2026-11-27',5,99,100,'2026-11-27 10:00+03')`, [pupil, video])
    await as(pupil)
    expect((await read('detail', p.id)).plans[0].items[0]).toMatchObject({ completed_at: null, theory_tab: 'theory' })
    await as(null, 'postgres')
    await db.query('update video_watch_daily set seconds=90 where item_id=$1', [video])
    await as(pupil)
    expect((await read('detail', p.id)).plans[0].done).toBe(1)
    await as(null, 'postgres')
    await db.query('delete from topics where id=$1', [topic])
    await as(pupil)
    expect((await read('detail', p.id)).plans[0].items[0]).toMatchObject({ available: false, topic_id: null })
    expect((await read('detail', p.id)).plans[0].items[0].completed_at).toBeTruthy()
  })

  it('напоминает один раз за день до общего срока и соблюдает настройки ученика', async () => {
    await as(null, 'postgres')
    const p = plan({ status: 'published', notify: true })
    await as(teacher)
    await save(p, [item(scenario[3][0], { due_on: '2026-11-29' })])
    await as(null, 'postgres')
    const deadlineKey = `work-plan:${p.id}:deadline:${p.ends_on}`
    await db.query('insert into notification_prefs(user_id,remind_hw_due_tomorrow) values ($1,false)', [pupil])
    await db.exec("select _work_plan_check_notices('2026-12-02 09:00+03')")
    expect(await scalar('select count(*)::int as value from notifications where dedup_key=$1', [deadlineKey])).toBe(0)
    await db.query('update notification_prefs set remind_hw_due_tomorrow=true where user_id=$1', [pupil])
    await db.exec("select _work_plan_check_notices('2026-11-29 09:00+03'); select _work_plan_check_notices('2026-12-02 08:45+03')")
    expect(await scalar('select count(*)::int as value from notifications where dedup_key=$1', [deadlineKey])).toBe(0)
    await db.exec("select _work_plan_check_notices('2026-12-02 09:00+03'); select _work_plan_check_notices('2026-12-02 09:15+03')")
    expect(await scalar('select count(*)::int as value from notifications where dedup_key=$1', [deadlineKey])).toBe(1)
    expect(await scalar("select payload->>'kind' as value from notification_queue where deduplication_key=$1", [deadlineKey])).toBe('deadline')
    expect(await scalar("select count(*)::int as value from notification_queue where entity_id=$1 and payload->>'kind' in ('today','overdue','weekly')", [p.id])).toBe(0)
    expect(await scalar("select schedule as value from cron.job where jobname='student-work-plan-notices'")).toBe('*/15 * * * *')
    await as(pupil)
    await expect(db.exec("select _work_plan_check_notices('2026-12-02 09:00+03')")).rejects.toThrow(/permission denied/)
  })

  it('сообщает автору и ученику о досрочном выполнении, окончании срока и ручном завершении', async () => {
    const early = plan({ student_id: ids.classmate, status: 'published', notify: true })
    const expired = plan({ student_id: ids.classmate, status: 'published', notify: true })
    await as(teacher)
    await save(early, [
      item(scenario[5][0], { due_on: early.ends_on }),
      item(scenario[6][0], { required: false, due_on: early.ends_on }),
    ])
    await save(expired, [item(scenario[6][0], { due_on: expired.ends_on })])
    await as(null, 'postgres')
    for (const [profile, chat] of [[teacher, 2], [classmate, 3]]) {
      await db.query('insert into telegram_connections(profile_id,telegram_chat_id) values ($1,$2)', [profile, chat])
    }
    const task = await scalar<string>('select id as value from topic_autocheck_tasks where topic_id=$1 limit 1', [scenario[5][0]])
    await db.query(`insert into topic_autocheck_answers(task_id,profile_id,is_correct,answer_raw,created_at)
                    values ($1,$2,true,'1','2026-11-28 12:00+03')`, [task, classmate])
    await db.exec("select _work_plan_check_notices('2026-11-28 12:15+03'); select _work_plan_check_notices('2026-11-28 12:30+03')")
    const { rows: completed } = await db.query(`select user_id, title, link from notifications
      where dedup_key in ($1,$2) order by link`, [`work-plan:${early.id}:completed`, `work-plan:${early.id}:completed:staff`])
    expect(completed).toEqual([
      { user_id: classmate, title: 'План работы выполнен', link: '/my-work-plan/' + early.id },
      { user_id: teacher, title: 'План работы выполнен', link: '/student-work-plans/' + early.id },
    ])
    expect(await scalar("select count(*)::int as value from notification_queue where entity_id=$1 and payload->>'kind'='completed'", [early.id])).toBe(2)
    await as(teacher)
    await save({ ...early, status: 'completed' }, [], 1)
    const manual = plan({ student_id: ids.classmate, status: 'published', notify: true })
    await save(manual, [item(scenario[6][0])])
    await save({ ...manual, status: 'completed' }, [], 1)
    await as(null, 'postgres')
    await db.exec("select _work_plan_check_notices('2026-12-02 09:00+03'); select _work_plan_check_notices('2026-12-04 00:00+03')")
    expect(await scalar("select count(*)::int as value from notifications where dedup_key like $1", [`work-plan:${early.id}:%`])).toBe(3)
    expect(await scalar("select count(*)::int as value from notifications where dedup_key like $1 and title='Срок плана работы закончился'", [`work-plan:${expired.id}:completed%`])).toBe(2)
    expect(await scalar("select count(*)::int as value from notifications where dedup_key like $1 and title='План работы завершён'", [`work-plan:${manual.id}:completed%`])).toBe(2)
  })

  it('фиксирует итог завершённого плана и скрывает отменённый от ученика', async () => {
    const p = plan({ status: 'published' })
    const cancelled = plan({ status: 'published' })
    const topic = scenario[6][0]
    await as(teacher)
    await save(p, [item(topic)])
    await save(cancelled, [item(topic)])
    await save({ ...p, status: 'completed' }, [], 1)
    await save({ ...cancelled, status: 'cancelled' }, [], 1)
    await as(null, 'postgres')
    const task = await scalar<string>('select id as value from topic_autocheck_tasks where topic_id=$1 limit 1', [topic])
    await db.query("insert into topic_autocheck_answers(task_id,profile_id,is_correct,answer_raw) values ($1,$2,true,'1')", [task, pupil])
    await as(pupil)
    expect((await read('detail', p.id)).plans[0]).toMatchObject({ status: 'completed', done: 0 })
    expect((await read('detail', cancelled.id)).plans).toEqual([])
    await as(teacher)
    expect((await read('staff_detail', cancelled.id)).plans[0].status).toBe('cancelled')
  })

  it('проверяет сводку в прежнем RPC и план выполнения на фоне чужих попыток', async () => {
    await as(null, 'postgres')
    const today = await scalar<string>("select ((now() at time zone 'Europe/Moscow')::date)::text as value")
    const tomorrow = await scalar<string>("select ($1::date + 1)::text as value", [today])
    const yesterday = await scalar<string>("select ($1::date - 1)::text as value", [today])
    const p = plan({ starts_on: today, ends_on: tomorrow, status: 'published' })
    const extended = plan({ starts_on: yesterday, ends_on: yesterday, status: 'published' })
    await as(teacher)
    await save(p, [item(scenario[0][0], { scheduled_on: today, due_on: today })])
    await save(extended, [item(scenario[4][0], { scheduled_on: yesterday, due_on: today })])
    await as(null, 'postgres')
    await db.query(`with extra_tasks as (
      insert into topic_autocheck_tasks(topic_id,code) select gen_random_uuid(),i::text from generate_series(1,20000) i returning id
    )
    insert into topic_autocheck_answers(task_id,profile_id,is_correct)
      select id,$1,true from extra_tasks`, [outsider])
    await db.exec('analyze student_work_plan_items; analyze topic_autocheck_tasks; analyze topic_autocheck_answers')
    await as(pupil)
    const home = await scalar<{ course_id: string; work_plans: WorkPlanRead }[]>('select student_home_courses() as value')
    expect(home[0].work_plans.plans.find(x => x.id === p.id)).toMatchObject({ total: 1, today_minutes: 60 })
    expect(home[0].work_plans.plans.find(x => x.id === extended.id)).toMatchObject({
      ends_on: yesterday, effective_until: today, today_minutes: 60, items: [expect.objectContaining({ due_on: today })],
    })
    await as(pupil, 'postgres')
    type Node = { 'Node Type': string; 'Index Name'?: string; Plans?: Node[] }
    type Explain = [{ 'Planning Time': number; 'Execution Time': number; Plan: Node }]
    async function explained(sql: string, params: unknown[] = []) {
      const query = await db.query<{ 'QUERY PLAN': Explain }>('explain (analyze, buffers, format json) ' + sql, params)
      return query.rows[0]['QUERY PLAN'][0]
    }
    const progressSql = await scalar<string>("select prosrc as value from pg_proc where oid='public._work_plan_progress(uuid[],date)'::regprocedure")
    const core = await explained(progressSql.replace(/\bp_ids\b/g, '$1::uuid[]').replace(/\bp_today\b/g, '$2::date'), [[p.id], today])
    const indexes = (node: Node): string[] => [...(node['Index Name'] ? [node['Index Name']] : []), ...(node.Plans ?? []).flatMap(indexes)]
    expect(indexes(core.Plan)).toContain('topic_autocheck_answers_profile_idx')
    const baseline = [], updated = []
    await db.exec(`create function public._test_original_student_home_courses() returns jsonb language sql
      stable security definer set search_path = public, pg_temp as $original$${originalHomeSql}$original$`)
    for (let i = 0; i < 7; i++) {
      baseline.push((await explained('select _test_original_student_home_courses()'))['Execution Time'])
      updated.push((await explained('select student_home_courses()'))['Execution Time'])
    }
    const median = (numbers: number[]) => numbers.slice(1).sort((a, b) => a - b)[3]
    console.log('PGlite EXPLAIN, 20 000 чужих ответов', {
      baselineHomeMs: median(baseline), newHomeMs: median(updated), scopedProgressMs: core['Execution Time'],
    })
  }, 20_000)

  it('откатывает подключение планов, сохраняя их данные и прежние функции', async () => {
    await as(null, 'postgres')
    const countSql = 'select count(*)::int as value from public.student_work_plans'
    const before = await scalar<number>(countSql)
    expect(before).toBeGreaterThan(0)
    await db.transaction(async tx => {
      await tx.exec(readFileSync(path.join(path.dirname(STUBS), 'workPlanDisable.sql'), 'utf8'))
      for (const definition of workPlanOriginalFunctions) await tx.exec(definition)
    })
    expect(await scalar(countSql)).toBe(before)
    expect(await Promise.all(workPlanReplacedFunctions.map(functionDefinition))).toEqual(workPlanOriginalFunctions)
    expect(await scalar("select count(*)::int as value from cron.job where jobname='student-work-plan-notices'")).toBe(0)
    expect(await scalar("select has_function_privilege('authenticated','public.student_work_plan_read(text,uuid,uuid,integer,integer,text)','execute') as value")).toBe(false)
    expect(await scalar("select count(*)::int as value from pg_trigger where tgname='student_work_plan_freeze_topic'")).toBe(0)
    expect(await scalar("select count(*)::int as value from notification_queue where event_type='student_work_plan' and status='pending'")).toBe(0)
    await as(pupil)
    const home = await scalar<object[]>('select public.student_home_courses() as value')
    expect(home[0]).not.toHaveProperty('work_plans')
  })
})
