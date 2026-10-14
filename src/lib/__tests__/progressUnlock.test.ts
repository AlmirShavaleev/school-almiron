/**
 * §288 — открытие уроков по прохождению. Настоящие миграции (цепочка
 * `src/test/sql/migrationChain.ts`) в PGlite поверх заглушек прод-объектов.
 *
 * Проверяется поведение: четыре условия открытия, закрытие урока (автопроверка
 * завершена + ДЗ второй части принято), возврат на доработку, персональные
 * отметки и массовые действия, % урока, режим 'schedule' без изменений,
 * доступ к материалам закрытого урока под `authenticated` с RLS, экран
 * «Прохождение» и его совпадение с воротами ученика.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, STUBS, migrationFiles } from '../../test/sql/migrationChain'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), KID = U(2), KID2 = U(3), OUTSIDER = U(4)

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
/** Видимые ученику уроки — тем же набором, что стоит в политиках. */
async function visible(uid: string): Promise<string[]> {
  await as(uid)
  const v = await val<string[]>(`select student_visible_topics()`)
  return [...v].sort()
}
const names = (ids: string[]) => ids.map((x) => Object.keys(id).find((k) => id[k] === x) ?? x).sort()

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  for (const f of migrationFiles()) await db.exec(readFileSync(f, 'utf8'))

  for (const [pid, role] of [[ADMIN, 'admin'], [KID, 'student'], [KID2, 'student'], [OUTSIDER, 'student']] as const) {
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)`,
      [pid, `u${pid.slice(-2)}@t.ru`, `Имя${pid.slice(-2)}`, role])
  }
  id.course = await val(`insert into courses (title) values ('Курс 288') returning id`)
  id.group = await val(`insert into groups (course_id, name) values ($1, 'g') returning id`, [id.course])
  id.kid = await val(`insert into students (profile_id) values ($1) returning id`, [KID])
  id.kid2 = await val(`insert into students (profile_id) values ($1) returning id`, [KID2])
  id.outsider = await val(`insert into students (profile_id) values ($1) returning id`, [OUTSIDER])
  for (const s of [id.kid, id.kid2]) await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [id.group, s])

  id.m1 = await val(`insert into modules (course_id, title, order_index) values ($1, 'Раздел 1', 1) returning id`, [id.course])
  id.m2 = await val(`insert into modules (course_id, title, order_index) values ($1, 'Раздел 2', 2) returning id`, [id.course])
  const topic = (m: string, n: number, extra = '') =>
    val<string>(`insert into topics (module_id, title, order_index ${extra ? ', available_from' : ''})
                 values ($1, $2, $3 ${extra ? ', $4::date' : ''}) returning id`,
      extra ? [m, `Урок ${n}`, n, extra] : [m, `Урок ${n}`, n])
  // Раздел 1: t1, t2 (ДЗ второй части), t3 (2 задачи автопроверки), t4 (дата в будущем), t5 (ничего)
  id.t1 = await topic(id.m1, 1)
  id.t2 = await topic(id.m1, 2)
  id.t3 = await topic(id.m1, 3)
  id.t4 = await topic(id.m1, 4, '2099-01-01')
  id.t5 = await topic(id.m1, 5)
  // Раздел 2: u1, u2, u3
  id.u1 = await topic(id.m2, 1)
  id.u2 = await topic(id.m2, 2)
  id.u3 = await topic(id.m2, 3)
  // is_open=false у урока раздела 2 — в 'schedule' закрывает, в 'progress' не читается
  await db.query(`update topics set is_open = false where id = $1`, [id.u2])

  id.hw2 = await val(`insert into topic_homework (topic_id, is_published) values ($1, true) returning id`, [id.t2])
  // u2 — ДЗ, которое никто не сдал: u3 открывается только через него
  id.hwu2 = await val(`insert into topic_homework (topic_id, is_published) values ($1, true) returning id`, [id.u2])
  id.k1 = await val(`insert into topic_autocheck_tasks (topic_id) values ($1) returning id`, [id.t3])
  id.k2 = await val(`insert into topic_autocheck_tasks (topic_id) values ($1) returning id`, [id.t3])
  id.hw3 = await val(`insert into topic_homework (topic_id, is_published, autocheck) values ($1, false, true) returning id`, [id.t3])
  for (const t of [id.t1, id.t3, id.u2]) await db.query(`insert into topic_material_items (topic_id) values ($1)`, [t])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('§288 открытие уроков по прохождению', () => {
  it("режим 'schedule' (по умолчанию) — как раньше: is_open и даты", async () => {
    // всё, что открыто по topic_open_now: без дат и без is_open=false
    expect(names(await visible(KID))).toEqual(names([id.t1, id.t2, id.t3, id.t5, id.u1, id.u3]))
    await as(KID)
    expect(await val(`select course_student_can_see_topic($1)`, [id.u2])).toBe(false)
    expect(await val(`select my_course_topic_locks($1)`, [id.course])).toEqual({ mode: 'schedule', topics: [] })
  })

  it('режим меняет только админ', async () => {
    await as(KID)
    expect(await errorOf(`select admin_course_unlock_mode_set($1, 'progress')`, [id.course])).toContain('ONLY_ADMIN')
    await as(ADMIN)
    expect(await val(`select admin_course_unlock_mode_set($1, 'progress')`, [id.course])).toBe('progress')
  })

  it("'progress': открыты первые 2 урока каждого раздела; is_open не читается; дата в будущем — закрыто", async () => {
    expect(names(await visible(KID))).toEqual(names([id.t1, id.t2, id.u1, id.u2]))
    await as(KID)
    expect(await val(`select course_student_can_see_topic($1)`, [id.t3])).toBe(false)
    expect(await val(`select course_student_can_see_topic($1)`, [id.u2])).toBe(true)
  })

  it('урок закрывается принятым ДЗ второй части → открыт следующий; возврат на доработку снова его закрывает', async () => {
    // как в RPC проверки: сдана → проверка → статус «принято»
    const att1 = await val<string>(
      `insert into topic_homework_attempts (homework_id, student_id, status, attempt_number) values ($1, $2, 'submitted', 1) returning id`,
      [id.hw2, id.kid])
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score) values ($1, 'accepted', 80)`, [att1])
    expect(await visible(KID)).not.toContain(id.t3)
    expect(await val(`select count(*)::int from topic_unlock_events where student_id = $1`, [id.kid])).toBe(0)
    await db.query(`update topic_homework_attempts set status = 'accepted' where id = $1`, [att1])
    expect(await visible(KID)).toContain(id.t3)
    // событие для будущего Telegram — один раз
    expect(await val(`select count(*)::int from topic_unlock_events where student_id = $1 and topic_id = $2 and reason = 'prev_closed'`,
      [id.kid, id.t3])).toBe(1)

    // пересдача: новая попытка возвращена на доработку — урок не закрыт, следующий снова под замком
    const att2 = await val<string>(
      `insert into topic_homework_attempts (homework_id, student_id, status, attempt_number) values ($1, $2, 'returned_for_revision', 2) returning id`,
      [id.hw2, id.kid])
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score) values ($1, 'returned_for_revision', 0)`, [att2])
    expect(await visible(KID)).not.toContain(id.t3)
  })

  it('урок закрыт по автопроверке: каждая задача — верно или 3 попытки; ДЗ автопроверки не мешает', async () => {
    // пересдача принята — балл 0, но урок закрыт
    const att = await val<string>(`select id from topic_homework_attempts where homework_id = $1 and attempt_number = 2`, [id.hw2])
    await db.query(`update topic_homework_attempts set status = 'accepted' where id = $1`, [att])
    await db.query(`update topic_homework_attempts set status = 'submitted' where homework_id = $1 and attempt_number = 1`, [id.hw2])
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score) values ($1, 'accepted', 0)`, [att])
    expect(await visible(KID)).toContain(id.t3)
    expect(await visible(KID)).not.toContain(id.t4)

    await db.query(`insert into topic_autocheck_answers (task_id, profile_id, attempt_no, is_correct) values ($1, $2, 1, true)`, [id.k1, KID])
    expect(await visible(KID)).not.toContain(id.t4) // вторая задача ещё не завершена
    for (const n of [1, 2, 3]) {
      await db.query(`insert into topic_autocheck_answers (task_id, profile_id, attempt_no, is_correct) values ($1, $2, $3, false)`, [id.k2, KID, n])
    }
    expect(await visible(KID)).toContain(id.t4)
    expect(await val(`select count(*)::int from topic_unlock_events where student_id = $1 and topic_id = $2`, [id.kid, id.t4])).toBe(1)
  })

  it('урок без ДЗ и автопроверки закрыт сразу; % урока — балл проверки ДЗ', async () => {
    // t4 открыт; у t4 ничего нет → закрыт → t5 открыт
    expect(await visible(KID)).toContain(id.t5)
    await as(KID)
    const locks = await val<{ mode: string; topics: Array<Record<string, unknown>> }>(`select my_course_topic_locks($1)`, [id.course])
    const byId = Object.fromEntries(locks.topics.map((t) => [t.topic_id as string, t]))
    expect(byId[id.t2]).toMatchObject({ closed: true, percent: 0, reason: 'first2' })
    expect(byId[id.t4]).toMatchObject({ open: true, reason: 'prev_closed', after_title: 'Урок 3', opens_on: '2099-01-01' })
    expect(byId[id.u3]).toMatchObject({ open: false, after_title: 'Урок 2' })
    // шкала «пятибалльная» → ×20
    await db.query(`update topic_homework set grade_scale = 'five' where id = $1`, [id.hw2])
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score)
                    select id, 'accepted', 4 from topic_homework_attempts where homework_id = $1 and attempt_number = 2`, [id.hw2])
    const again = await val<{ topics: Array<Record<string, unknown>> }>(`select my_course_topic_locks($1)`, [id.course])
    expect(again.topics.find((t) => t.topic_id === id.t2)).toMatchObject({ percent: 80 })
  })

  it('дата наступила — урок открыт, даже если предыдущий не закрыт', async () => {
    expect(await visible(KID2)).not.toContain(id.t4)
    await db.query(`update topics set available_from = current_date - 1 where id = $1`, [id.t4])
    expect(await visible(KID2)).toContain(id.t4)
    await db.query(`update topics set available_from = '2099-01-01' where id = $1`, [id.t4])
  })

  it("персональные отметки: 'open' открывает, 'closed' закрывает даже первый урок; снятие возвращает правило", async () => {
    await as(KID)
    expect(await errorOf(`select staff_topic_override_set($1, $2, 'open')`, [id.kid2, id.u3])).toContain('ONLY_STAFF')
    await as(ADMIN)
    expect(await errorOf(`select staff_topic_override_set($1, $2, 'open')`, [id.outsider, id.u3])).toContain('NOT_IN_COURSE')
    await db.query(`select staff_topic_override_set($1, $2, 'open', 'догоняет')`, [id.kid2, id.u3])
    await db.query(`select staff_topic_override_set($1, $2, 'closed')`, [id.kid2, id.t1])
    const v = await visible(KID2)
    expect(v).toContain(id.u3)
    expect(v).not.toContain(id.t1)
    await as(ADMIN)
    await db.query(`select staff_topic_override_set($1, $2, null)`, [id.kid2, id.t1])
    expect(await visible(KID2)).toContain(id.t1)
    expect(await val(`select count(*)::int from student_topic_override_log where student_id = $1`, [id.kid2])).toBe(3)
    // ученик свои отметки прямым запросом не видит
    await as(KID2)
    await db.exec('set role authenticated')
    try {
      expect(await errorOf(`select * from student_topic_overrides`)).toContain('permission denied')
    } finally {
      await db.exec('reset role')
    }
  })

  it('массовые: открыть урок всем ученикам курса; открыть ученику весь раздел', async () => {
    await as(ADMIN)
    expect(await val(`select staff_topic_open_for_course($1)`, [id.t5])).toBe(2)
    expect(await visible(KID2)).toContain(id.t5)
    await as(ADMIN)
    expect(await val(`select staff_module_open_for_student($1, $2)`, [id.kid2, id.m1])).toBe(5)
    expect(await visible(KID2)).toEqual(expect.arrayContaining([id.t3, id.t4]))
    expect(await visible(KID)).not.toContain(id.u3) // другого ученика не задело
  })

  it('файлы course-materials и старая topic_materials: закрытый урок — нет, открытый — да', async () => {
    await db.query(`insert into topic_materials (topic_id) values ($1), ($2)`, [id.t1, id.u3])
    await as(KID)
    expect(await val(`select auth_is_student_of_topic($1)`, [id.t1])).toBe(true)
    expect(await val(`select auth_is_student_of_topic($1)`, [id.u3])).toBe(false)
    await db.exec('set role authenticated')
    try {
      const got = (await db.query<{ topic_id: string }>(`select topic_id from topic_materials`)).rows.map((r) => r.topic_id)
      expect(got).toEqual([id.t1])
    } finally {
      await db.exec('reset role')
    }
  })

  it('RLS: материалы закрытого урока ученику не отдаются прямым запросом', async () => {
    await as(ADMIN)
    await db.query(`select staff_topic_override_set($1, $2, 'closed')`, [id.kid, id.t1])
    await as(KID)
    await db.exec('set role authenticated')
    try {
      const rows = await db.query<{ topic_id: string }>(`select topic_id from topic_material_items`)
      const got = rows.rows.map((r) => r.topic_id)
      expect(got).toContain(id.t3)
      expect(got).not.toContain(id.t1)
    } finally {
      await db.exec('reset role')
    }
    await as(ADMIN)
    await db.query(`select staff_topic_override_set($1, $2, null)`, [id.kid, id.t1])
  })

  it('экран «Прохождение»: только персонал; открытое в матрице = ворота ученика', async () => {
    await as(KID)
    expect(await errorOf(`select course_progress_matrix($1)`, [id.course])).toContain('ONLY_STAFF')
    await as(ADMIN)
    const m = await val<{ mode: string; topics: Array<{ id: string }>; students: Array<{ id: string; cells: unknown[][]; closed: number }> }>(
      `select course_progress_matrix($1)`, [id.course])
    expect(m.mode).toBe('progress')
    expect(m.topics).toHaveLength(8)
    expect(m.students.map((s) => s.id).sort()).toEqual([id.kid, id.kid2].sort())
    for (const s of m.students) {
      const openInMatrix = m.topics.filter((_, i) => s.cells[i][0] !== 'locked').map((t) => t.id).sort()
      expect(openInMatrix).toEqual(await visible(s.id === id.kid ? KID : KID2))
    }
    await as(ADMIN) // visible() переключил пользователя
    const kid = m.students.find((s) => s.id === id.kid)!
    const cell = (t: string) => kid.cells[m.topics.findIndex((x) => x.id === t)]
    expect(cell(id.t2)).toEqual(['closed', 'first2', 0, 'accepted', 80, null])
    expect(cell(id.u3)).toEqual(['locked', null, 0, 'none', null, null])
    // ДЗ на проверке — отдельное состояние
    await db.query(`insert into topic_homework_attempts (homework_id, student_id, status, attempt_number) values ($1, $2, 'submitted', 1)`, [id.hw2, id.kid2])
    const m2 = await val<typeof m>(`select course_progress_matrix($1)`, [id.course])
    const kid2 = m2.students.find((s) => s.id === id.kid2)!
    expect(kid2.cells[m2.topics.findIndex((x) => x.id === id.t2)][0]).toBe('pending_review')
  })

  it('превью персонала «глазами ученика»: первые 2 и даты, без прогресса', async () => {
    await as(ADMIN)
    const locks = await val<{ preview: boolean; topics: Array<Record<string, unknown>> }>(`select my_course_topic_locks($1)`, [id.course])
    expect(locks.preview).toBe(true)
    expect(locks.topics.filter((t) => t.open).map((t) => t.topic_id).sort()).toEqual([id.t1, id.t2, id.u1, id.u2].sort())
  })
})

describe('§288.1 «урок открыт ученику» везде, Telegram «Открыт урок», файлы только открытых', () => {
  const c: Record<string, string> = {}
  const K3 = U(5)

  beforeAll(async () => {
    // Раздел 2 файла (замена тел 17 функций) здесь не применяется: этих функций
    // нет в заглушках; их фрагменты сверены на проде (по одному в каждой).
    const name = readdirSync(MIGRATIONS).find((f) => /^(PENDING_288_1_open_states|\d+_288_1_open_states)\.sql$/.test(f))
    if (!name) throw new Error('Не найдена миграция §288.1')
    const file = readFileSync(path.join(MIGRATIONS, name), 'utf8')
    const a = file.indexOf('-- 2. Замена вызова')
    const b = file.indexOf('-- study_plan_freeze_topic_internal')
    const cut = file.slice(0, file.lastIndexOf('\n', file.lastIndexOf('-- ───', a))) + '\n' + file.slice(b)
    await db.exec(cut)

    await as(null)
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, 'k3@t.ru', 'Ученик Три', 'student')`, [K3])
    c.student = await val(`insert into students (profile_id) values ($1) returning id`, [K3])
    // курс по датам: урок с датой в будущем и открытый
    c.sched = await val(`insert into courses (title) values ('По датам') returning id`)
    c.gs = await val(`insert into groups (course_id, name) values ($1, 's') returning id`, [c.sched])
    const ms = await val<string>(`insert into modules (course_id, title) values ($1, 'М') returning id`, [c.sched])
    c.sOpen = await val(`insert into topics (module_id, title, order_index) values ($1, 'Открыт', 1) returning id`, [ms])
    c.sLater = await val(`insert into topics (module_id, title, order_index, available_from) values ($1, 'Позже', 2, '2099-01-01') returning id`, [ms])
    // курс по прохождению: p1, p2 (ДЗ), p3
    c.prog = await val(`insert into courses (title) values ('По прохождению') returning id`)
    c.gp = await val(`insert into groups (course_id, name) values ($1, 'p') returning id`, [c.prog])
    const mp = await val<string>(`insert into modules (course_id, title) values ($1, 'М') returning id`, [c.prog])
    c.p1 = await val(`insert into topics (module_id, title, order_index) values ($1, 'П1', 1) returning id`, [mp])
    c.p2 = await val(`insert into topics (module_id, title, order_index) values ($1, 'П2', 2) returning id`, [mp])
    c.p3 = await val(`insert into topics (module_id, title, order_index) values ($1, 'П3', 3) returning id`, [mp])
    c.hw = await val(`insert into topic_homework (topic_id, is_published) values ($1, true) returning id`, [c.p2])
    for (const g of [c.gs, c.gp]) await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [g, c.student])
    await as(ADMIN)
    await db.query(`select admin_course_unlock_mode_set($1, 'progress')`, [c.prog])
  })

  it('topic_open_with: нет флага — прежний topic_open_now; есть — флаг', async () => {
    await as(null)
    expect(await val(`select topic_open_with('{}'::jsonb, 'x', null, null)`)).toBe(true)
    expect(await val(`select topic_open_with('{}'::jsonb, 'x', false, null)`)).toBe(false)
    expect(await val(`select topic_open_with('{}'::jsonb, 'x', null, '2099-01-01')`)).toBe(false)
    expect(await val(`select topic_open_with('{"x": true}'::jsonb, 'x', false, '2099-01-01')`)).toBe(true)
    expect(await val(`select topic_open_with('{"x": false}'::jsonb, 'x', true, null)`)).toBe(false)
  })

  it('флаги — только по курсам «по прохождению»; по ученику и «хотя бы одному»', async () => {
    await as(null)
    const f = await val<Record<string, boolean>>(`select progress_open_by_student(null, array[$1]::uuid[])`, [c.student])
    expect(f).toEqual({ [`${c.student}:${c.p1}`]: true, [`${c.student}:${c.p2}`]: true, [`${c.student}:${c.p3}`]: false })
    // курс по датам во флаги не попадает — значит, его результат прежний
    expect(await val(`select progress_open_by_student(array[$1]::uuid[], null)`, [c.sched])).toEqual({})
    expect(await val(`select progress_open_any(array[$1, $2]::uuid[])`, [c.sched, c.prog]))
      .toEqual({ [c.p1]: true, [c.p2]: true, [c.p3]: false })
    // без курсов и учеников — пусто (не «все ученики базы»)
    expect(await val(`select progress_open_by_student(null, null)`)).toEqual({})
  })

  it('Telegram «Открыт урок»: при подключённом боте — в очередь с ссылкой на урок, один раз', async () => {
    await as(null)
    await db.query(`insert into telegram_connections (profile_id, telegram_chat_id) values ($1, 12345)`, [K3])
    const att = await val<string>(
      `insert into topic_homework_attempts (homework_id, student_id, status, attempt_number) values ($1, $2, 'submitted', 1) returning id`,
      [c.hw, c.student])
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score) values ($1, 'accepted', 70)`, [att])
    await db.query(`update topic_homework_attempts set status = 'accepted' where id = $1`, [att])
    const q = (await db.query<{ event_type: string; payload: Record<string, unknown>; profile_id: string }>(
      `select event_type, payload, profile_id from notification_queue where entity_id = $1`, [c.p3])).rows
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ event_type: 'topic_unlocked', profile_id: K3 })
    expect(q[0].payload).toEqual({ course_title: 'По прохождению', title: 'П3', link: `/my-course/${c.gp}/topic/${c.p3}` })
    expect(await val(`select notified_at is not null from topic_unlock_events where student_id = $1 and topic_id = $2`, [c.student, c.p3])).toBe(true)
    // повторное событие по тому же уроку — без второго сообщения
    await db.query(`insert into topic_homework_reviews (attempt_id, decision, score) values ($1, 'accepted', 80)`, [att])
    await db.query(`update topic_homework_attempts set status = 'submitted' where id = $1`, [att])
    await db.query(`update topic_homework_attempts set status = 'accepted' where id = $1`, [att])
    expect(await val(`select count(*)::int from notification_queue where entity_id = $1`, [c.p3])).toBe(1)
  })

  it('файлы course-materials: в курсе по датам — только открытого урока; по прохождению — по воротам', async () => {
    await as(K3)
    expect(await val(`select auth_is_student_of_topic($1)`, [c.sOpen])).toBe(true)
    expect(await val(`select auth_is_student_of_topic($1)`, [c.sLater])).toBe(false)
    expect(await val(`select auth_is_student_of_topic($1)`, [c.p3])).toBe(true)
    await as(ADMIN)
    await db.query(`select staff_topic_override_set($1, $2, 'closed')`, [c.student, c.p1])
    await as(K3)
    expect(await val(`select auth_is_student_of_topic($1)`, [c.p1])).toBe(false)
  })
})
