/**
 * §290-A — путь ученика «с улицы» в базе. Настоящие миграции (цепочка
 * `migrationChain.ts` + PENDING_290_a_path.sql + PENDING_290_b_demo_catalog.sql)
 * в PGlite поверх заглушек прод-объектов.
 *
 * Поведение: анкета (кому показывать, проверка полей, цель в
 * student_subject_targets), витрина «Курсы» (цены месяц/год, «−N %»,
 * пробный, «Скоро»), демо = строго первые 2 урока раздела, банк задач
 * (RLS и RPC) только тем, кому положено, «заканчивается завтра». И главное —
 * школьникам ничего не меняется.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, STUBS, migrationFiles } from '../../test/sql/migrationChain'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), SCHOOL = U(2), STREET = U(3), STREET2 = U(4), TEACHER = U(5), KIDP = U(6)

let db: PGlite
const id: Record<string, string> = {}

async function as(uid: string | null) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
}
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, p)
  return Object.values(r.rows[0] ?? {})[0] as T
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    const err = e as { message?: string; hint?: string }
    return `${err.hint ?? ''} ${err.message ?? ''}`
  }
}
/** Под authenticated с RLS (владелец таблиц RLS обходит). */
async function asAuthenticated<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await as(uid)
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
const bankRows = (uid: string) => asAuthenticated(uid, () => val<number>(`select count(*)::int from catalog_tasks`))
async function visible(uid: string): Promise<string[]> {
  await as(uid)
  return [...(await val<string[]>(`select student_visible_topics()`))].sort()
}
const names = (ids: string[]) => ids.map((x) => Object.keys(id).find((k) => id[k] === x) ?? x).sort()
const file = (re: RegExp) => {
  const f = readdirSync(MIGRATIONS).find((x) => re.test(x))
  if (!f) throw new Error(`Не найдена миграция ${re}`)
  return readFileSync(path.join(MIGRATIONS, f), 'utf8')
}

// Прод-объекты, которых нет в общих заглушках: цели, банк задач и его RPC с
// теми же якорями («нужен вход», чтение роли), что в телах на проде 13.10.
const LOGIN_RPCS: Array<[string, string]> = [
  ['catalog_check_answer', 'p_task_id uuid, p_answer text'],
  ['catalog_my_overview', ''],
  ['catalog_practice_state', 'p_section_id uuid, p_task_ids uuid[]'],
  ['catalog_reveal_answer', 'p_task_id uuid'],
  ['catalog_reveal_answers', 'p_task_ids uuid[]'],
  ['catalog_task_texts', 'p_task_ids uuid[]'],
  ['student_daily_task', 'p_subject text'],
]
const EXTRA_STUBS = `
create type public.subject_type as enum ('physics','math','algebra','geometry','probability_statistics');
create type public.exam_type as enum ('ege','oge','grade_7','grade_8','grade_9','grade_10','grade_11');
create table public.student_subject_targets (id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade, subject public.subject_type not null,
  exam_type public.exam_type not null, target_score smallint not null check (target_score between 0 and 100),
  updated_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (student_id, subject, exam_type));
create table public.catalog_tasks (id uuid primary key default gen_random_uuid(), is_published boolean not null default true);
alter table public.catalog_tasks enable row level security;
create policy catalog_tasks_select_auth on public.catalog_tasks for select using ((select auth.uid()) is not null and is_published);
grant select on public.catalog_tasks to authenticated;
create type public.variant_item_input as (task_id uuid);
create type public.variant_section_input as (section_id uuid);
${LOGIN_RPCS.map(([fn, args]) => `
create function public.${fn}(${args}) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '${fn}: нужен вход' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end $f$;`).join('\n')}
create function public.create_self_built_variant(p_title text, p_subject text, p_exam_type text, p_items public.variant_item_input[])
returns uuid language plpgsql security definer set search_path = public as $f$
DECLARE
  v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN gen_random_uuid();
END $f$;
create function public.generate_variant_tasks(p_sections public.variant_section_input[])
returns int language plpgsql stable security definer set search_path = public as $f$
DECLARE
  v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN 1;
END $f$;
create function public.generate_variant_tasks_by_topic(p_subject text, p_exam_type text, p_topic_ids uuid[], p_levels jsonb, p_topic_source text default null)
returns int language plpgsql security definer set search_path = '' as $f$
DECLARE
  v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN 1;
END $f$;
`

let baselineProgress: string[] = []

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  await db.exec(EXTRA_STUBS)
  for (const f of migrationFiles()) await db.exec(readFileSync(f, 'utf8'))
  await db.exec(file(/^(PENDING_290_a_path|\d+_290_a_path)\.sql$/))

  for (const [pid, role] of [[ADMIN, 'admin'], [SCHOOL, 'student'], [STREET, 'student'], [STREET2, 'student'],
    [TEACHER, 'teacher'], [KIDP, 'student']] as const) {
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)`,
      [pid, `u${pid.slice(-2)}@t.ru`, `Имя${pid.slice(-2)}`, role])
  }
  // Школьный курс по датам и школьный курс «по прохождению» — без тарифов
  id.free = await val(`insert into courses (title) values ('Школа') returning id`)
  id.freeGroup = await val(`insert into groups (course_id, name) values ($1, 'g') returning id`, [id.free])
  id.school = await val(`insert into students (profile_id) values ($1) returning id`, [SCHOOL])
  await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [id.freeGroup, id.school])
  id.freeP = await val(`insert into courses (title) values ('Школа, прохождение') returning id`)
  id.freePGroup = await val(`insert into groups (course_id, name) values ($1, 'gp') returning id`, [id.freeP])
  id.kidp = await val(`insert into students (profile_id) values ($1) returning id`, [KIDP])
  await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [id.freePGroup, id.kidp])
  await db.query(`insert into course_unlock_modes (course_id, mode) values ($1, 'progress')`, [id.freeP])

  // Подписочный курс: 2 раздела по 4 урока, режим 'progress'
  id.paid = await val(`insert into courses (title) values ('Физика ЕГЭ — подписка') returning id`)
  await db.query(`insert into course_unlock_modes (course_id, mode) values ($1, 'progress')`, [id.paid])
  for (const [course, pfx] of [[id.paid, 'p'], [id.freeP, 'f']] as const) {
    for (const m of [1, 2]) {
      const mod = await val<string>(`insert into modules (course_id, title, order_index) values ($1, $2, $3) returning id`,
        [course, `Раздел ${m}`, m])
      for (const n of [1, 2, 3, 4]) {
        id[`${pfx}${m}_${n}`] = await val(`insert into topics (module_id, title, order_index) values ($1, $2, $3) returning id`,
          [mod, `Урок ${m}.${n}`, n])
      }
    }
  }
  // Пустой урок считается пройденным и открывает следующий; в уроке 3 каждого
  // раздела — задача автопроверки, на нём цепочка «по прохождению» встаёт.
  for (const t of [id.p1_1, id.p1_3, id.p2_3, id.f1_3, id.f2_3]) await db.query(`insert into topic_autocheck_tasks (topic_id) values ($1)`, [t])
  // Урок 1.4 — дата наступила; 1.3 подписочного откроем вручную (в демо не действуют)
  await db.query(`update topics set available_from = current_date - 1 where id = any($1)`, [[id.p1_4, id.f1_4]])

  await as(ADMIN)
  id.month = await val(`insert into subscription_tariffs (course_id, title, price_rub, period_months, trial_days, is_active)
                        values ($1, 'Месяц', 500, 1, 3, true) returning id`, [id.paid])
  id.year = await val(`insert into subscription_tariffs (course_id, title, price_rub, period_months, trial_days, is_active)
                       values ($1, 'Год', 4800, 12, 3, true) returning id`, [id.paid])
  for (let i = 0; i < 3; i++) await db.query(`insert into catalog_tasks default values`)

  // До части 2: открытые уроки школьника курса «по прохождению»
  baselineProgress = await visible(KIDP)
  await db.exec(file(/^(PENDING_290_b_demo_catalog|\d+_290_b_demo_catalog)\.sql$/))
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('§290-A: школьникам ничего не меняется', () => {
  it('курс «по прохождению» без подписки — те же открытые уроки, что до части 2', async () => {
    expect(names(await visible(KIDP))).toEqual(names(baselineProgress))
    expect(names(baselineProgress)).toEqual(names([id.f1_1, id.f1_2, id.f1_3, id.f1_4, id.f2_1, id.f2_2, id.f2_3]))
  })

  it('пока подписка закрыта (флаг выключен / режим тестировщиков) — банк открыт всем ученикам', async () => {
    for (const uid of [SCHOOL, STREET, STREET2, TEACHER]) expect(await bankRows(uid)).toBe(3)
    await as(STREET)
    expect(await val(`select catalog_check_answer(gen_random_uuid(), '1')`)).toEqual({ ok: true })
  })

  it('анкета школьнику не нужна', async () => {
    await as(SCHOOL)
    expect(await val(`select onboarding_state()`)).toMatchObject({ needed: false, completed: false })
    await as(TEACHER)
    expect(await val(`select onboarding_state()`)).toMatchObject({ needed: false })
  })
})

describe('§290-A: анкета', () => {
  it('ученик «с улицы» — нужна; поля проверяются; ОГЭ пока нельзя', async () => {
    await as(STREET)
    expect(await val(`select onboarding_state()`)).toMatchObject({ needed: true, completed: false, diagnostic_status: 'none' })
    const bad = [
      { grade: 8, subject: 'physics', target_score: 80 },
      { grade: 11, subject: 'chemistry', target_score: 80 },
      { grade: 11, subject: 'physics', target_score: 101 },
      { grade: 11, exam: 'oge', subject: 'physics', target_score: 80 },
      { grade: 'одиннадцатый', subject: 'physics', target_score: 80 },
    ]
    for (const p of bad) expect(await errorOf(`select onboarding_save($1::jsonb)`, [JSON.stringify(p)])).toContain('BAD_INPUT')
    await as(TEACHER)
    expect(await errorOf(`select onboarding_save($1::jsonb)`, [JSON.stringify({ grade: 11, subject: 'physics', target_score: 80 })]))
      .toContain('NOT_STUDENT')
  })

  it('сохранение: анкета пройдена, цель — в student_subject_targets; цель преподавателя не перетирается', async () => {
    await as(STREET)
    const st = await val(`select onboarding_save($1::jsonb)`,
      [JSON.stringify({ grade: 11, exam: 'ege', subject: 'physics', target_score: 85, months_to_exam: 7, hours_per_week: 6 })])
    expect(st).toMatchObject({ needed: false, completed: true, grade: 11, subject: 'physics', target_score: 85 })
    id.street = await val(`select id from students where profile_id = $1`, [STREET])
    expect(await val(`select target_score from student_subject_targets where student_id = $1`, [id.street])).toBe(85)
    await db.query(`update student_subject_targets set target_score = 70, updated_by = $1 where student_id = $2`, [TEACHER, id.street])
    await as(STREET)
    await db.query(`select onboarding_save($1::jsonb)`, [JSON.stringify({ grade: 11, subject: 'physics', target_score: 95 })])
    expect(await val(`select target_score from student_subject_targets where student_id = $1`, [id.street])).toBe(70)
    expect(await val(`select onboarding_skip_diagnostic()`)).toMatchObject({ diagnostic_status: 'skipped' })
  })

  it('RLS: своё читает, чужое — нет; писать напрямую нельзя', async () => {
    expect(await asAuthenticated(STREET, () => val(`select count(*)::int from student_onboarding`))).toBe(1)
    expect(await asAuthenticated(STREET2, () => val(`select count(*)::int from student_onboarding`))).toBe(0)
    expect(await asAuthenticated(STREET2, () => errorOf(
      `insert into student_onboarding (profile_id, grade, subject, target_score) values ($1, 11, 'math', 50)`, [STREET2])))
      .toContain('permission denied')
  })
})

describe('§290-A: витрина «Курсы»', () => {
  it('подписка закрыта — пусто; тестировщику — карточки; цены месяц/год и −20 % из тарифов', async () => {
    await as(STREET)
    expect(await val(`select courses_showcase()`)).toEqual([])
    await db.query(`update app_feature_flags set enabled = true where key = 'subscriptions'`)
    await db.query(`insert into subscription_testers (profile_id) values ($1)`, [STREET])
    await db.query(`update course_showcase set course_id = $1, status = 'live' where slug = 'physics-ege'`, [id.paid])
    await as(STREET)
    const cards = await val<Array<Record<string, unknown>>>(`select courses_showcase()`)
    expect(cards.map((c) => c.slug)).toEqual(['physics-ege', 'math-ege-part1', 'math-ege-part2'])
    expect(cards[0]).toMatchObject({
      status: 'live', month_price: 500, year_price: 4800, year_discount_pct: 20, trial_days: 3,
      trial_available: true, has_access: false, my_status: null,
    })
    expect((cards[0].tariffs as unknown[]).length).toBe(2)
    expect(cards[1]).toMatchObject({ status: 'soon', tariffs: [], month_price: null })
    await as(STREET2)
    expect(await val(`select courses_showcase()`)).toEqual([])
  })

  it('«Сообщить о запуске» — один раз; курс без действующих тарифов — «Скоро»', async () => {
    await as(STREET)
    const soon = await val<string>(`select id from course_showcase where slug = 'math-ege-part2'`)
    expect(await val(`select course_showcase_notify($1)`, [soon])).toBe(true)
    expect(await val(`select course_showcase_notify($1)`, [soon])).toBe(true)
    expect(await val(`select count(*)::int from course_showcase_waitlist`)).toBe(1)
    const cards = await val<Array<Record<string, unknown>>>(`select courses_showcase()`)
    expect(cards.find((c) => c.slug === 'math-ege-part2')).toMatchObject({ notify_requested: true })
    // ученик не может сам переключить витрину
    expect(await asAuthenticated(STREET, () => errorOf(`update course_showcase set status = 'live'`))).toBeNull()
    expect(await val(`select count(*)::int from course_showcase where status = 'live'`)).toBe(1)
  })
})

describe('§290-A: демо = первые 2 урока раздела', () => {
  it('пробный: открыты строго первые 2 урока каждого раздела — ни прохождение, ни дата, ни ручное «открыть»', async () => {
    await as(STREET)
    await db.query(`select subscription_start_trial($1, false, false, true)`, [id.year])
    await db.query(`insert into student_topic_overrides (student_id, topic_id, state) values ($1, $2, 'open')`, [id.street, id.p1_3])
    expect(names(await visible(STREET))).toEqual(names([id.p1_1, id.p1_2, id.p2_1, id.p2_2]))
    await as(STREET)
    expect(await val(`select course_student_can_see_topic($1)`, [id.p1_4])).toBe(false)
    const reasons = await val<Array<{ topic_id: string; open: boolean; open_reason: string | null }>>(
      `select jsonb_agg(jsonb_build_object('topic_id', topic_id, 'open', open, 'open_reason', open_reason))
         from _progress_state($1, array[$2]::uuid[])`, [id.paid, id.street])
    expect(reasons.filter((r) => r.open).every((r) => r.open_reason === 'first2')).toBe(true)
  })

  it('главная: демо, срок и «Продолжить урок»; страница курса: my_course_demo', async () => {
    await as(STREET)
    const home = await val<{ onboarding: Record<string, unknown>; subscriptions: Array<Record<string, unknown>> }>(`select student_path_home()`)
    expect(home.onboarding).toMatchObject({ completed: true })
    expect(home.subscriptions).toHaveLength(1)
    expect(home.subscriptions[0]).toMatchObject({
      course_id: id.paid, status: 'trial', source: 'trial', demo: true, has_access: true,
      continue: { topic_id: id.p1_1, title: 'Урок 1.1', module_title: 'Раздел 1' },
    })
    expect(await val(`select my_course_demo($1)`, [id.paid])).toMatchObject({ demo: true })
    expect(await val(`select my_course_demo($1)`, [id.free])).toMatchObject({ demo: false })
    await as(SCHOOL)
    expect(await val(`select student_path_home()`)).toMatchObject({ subscriptions: [] })
  })

  it('после оплаты — обычный режим «по прохождению»: прохождение, дата и ручная отметка открывают', async () => {
    await db.query(`update student_subscriptions set status = 'active', source = 'purchase' where student_id = $1`, [id.street])
    expect(names(await visible(STREET))).toEqual(names([id.p1_1, id.p1_2, id.p1_3, id.p1_4, id.p2_1, id.p2_2, id.p2_3]))
    await db.query(`update student_subscriptions set status = 'trial', source = 'trial' where student_id = $1`, [id.street])
  })

  it('промокод «N дней бесплатно» (status trial, source manual — как ставит _subscription_promo_grant) — курс целиком', async () => {
    await db.query(`update student_subscriptions set source = 'manual' where student_id = $1`, [id.street])
    expect(names(await visible(STREET))).toEqual(names([id.p1_1, id.p1_2, id.p1_3, id.p1_4, id.p2_1, id.p2_2, id.p2_3]))
    await db.query(`update student_subscriptions set source = 'trial' where student_id = $1`, [id.street])
    expect(names(await visible(STREET))).toEqual(names([id.p1_1, id.p1_2, id.p2_1, id.p2_2]))
  })
})

describe('§290-A: банк задач', () => {
  it('подписка открыта: персонал, школьник, пробный — видят; не тестировщик — пока как раньше', async () => {
    for (const uid of [SCHOOL, STREET, TEACHER, STREET2, ADMIN]) expect(await bankRows(uid)).toBe(3)
  })

  it('пробный кончился — банк закрыт и в RLS, и в RPC; школьник и персонал — как раньше', async () => {
    await db.query(`update student_subscriptions set access_until = now() - interval '1 minute' where student_id = $1`, [id.street])
    expect(await bankRows(STREET)).toBe(0)
    await as(STREET)
    for (const sql of [
      `select catalog_check_answer(gen_random_uuid(), '1')`,
      `select catalog_task_texts(array[gen_random_uuid()])`,
      `select catalog_reveal_answer(gen_random_uuid())`,
      `select student_daily_task('physics')`,
      `select generate_variant_tasks(array[]::variant_section_input[])`,
      `select generate_variant_tasks_by_topic('physics', 'ege', array[]::uuid[], '{}'::jsonb)`,
      `select create_self_built_variant('x', 'physics', 'ege', array[]::variant_item_input[])`,
    ]) expect(await errorOf(sql)).toContain('CATALOG_LOCKED')
    expect(await bankRows(SCHOOL)).toBe(3)
    expect(await bankRows(TEACHER)).toBe(3)
    await as(SCHOOL)
    expect(await val(`select catalog_check_answer(gen_random_uuid(), '1')`)).toEqual({ ok: true })
    await as(TEACHER)
    expect(await val(`select generate_variant_tasks_by_topic('physics', 'ege', array[]::uuid[], '{}'::jsonb)`)).toBe(1)
  })

  it('«для всех»: ученик без группы и без подписки банк не видит; проверка вставлена ровно один раз', async () => {
    await db.query(`update subscription_settings set audience = 'everyone'`)
    expect(await bankRows(STREET2)).toBe(0)
    expect(await bankRows(SCHOOL)).toBe(3)
    const d = await val<string>(`select pg_get_functiondef('public.catalog_check_answer(uuid, text)'::regprocedure)`)
    expect(d.split('CATALOG_LOCKED').length - 1).toBe(1)
    await db.query(`update subscription_settings set audience = 'testers'`)
  })
})

describe('§290-A: «подписка заканчивается завтра»', () => {
  it('за сутки — письмо, уведомление и Telegram, один раз; автопродление и далёкий срок — нет', async () => {
    await db.query(`insert into telegram_connections (profile_id, telegram_chat_id) values ($1, 42)`, [STREET])
    await db.query(`update student_subscriptions set status = 'trial', access_until = now() + interval '10 hours',
                      auto_renew = false where student_id = $1`, [id.street])
    // второй подписчик: автопродление — не напоминаем
    await as(STREET2)
    id.street2 = await val(`select _subscription_students_row($1)`, [STREET2])
    await db.query(`insert into student_subscriptions (student_id, course_id, tariff_id, status, access_until, auto_renew, next_charge_at)
                    values ($1, $2, $3, 'active', now() + interval '5 hours', true, now() + interval '5 hours')`,
      [id.street2, id.paid, id.month])
    expect(await val(`select subscription_ending_soon_tick()`)).toBe(1)
    expect(await val(`select subscription_ending_soon_tick()`)).toBe(0)
    expect(await val(`select kind from subscription_mail_outbox`)).toBe('ending_soon')
    expect(await val(`select title from notifications where user_id = $1 order by created_at desc limit 1`, [STREET]))
      .toBe('Пробный период заканчивается завтра')
    expect(await val(`select payload from notification_queue where event_type = 'subscription_ending'`))
      .toMatchObject({ trial: true, link: '/my-subscription' })
    // через 3 дня — ещё не время
    await db.query(`update student_subscriptions set access_until = now() + interval '3 days' where student_id = $1`, [id.street])
    expect(await val(`select subscription_ending_soon_tick()`)).toBe(0)
  })

  it('cron заведён раз в час', async () => {
    expect(await val(`select schedule from cron.job where jobname = 'subscription-ending-soon'`)).toBe('23 * * * *')
  })
})
