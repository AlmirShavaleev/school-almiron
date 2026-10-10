/**
 * §282 «Подписка» — логика доступа и статусов в SQL, прогон настоящих миграций
 * на PGlite (Postgres в WASM) поверх заглушек прод-объектов
 * (`src/test/sql/subscriptionStubs.sql`).
 *
 * Проверяется поведение функций, а не текст: правило доступа, пробный период,
 * оплата и её идемпотентность, автосписание с повторами, возврат, админка,
 * очередь писем — под владельцем базы. Последний блок (§282.2) — под ролью
 * `authenticated`, с RLS: что ученик видит в таблицах курса с подпиской и без.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const STUBS = path.resolve(__dirname, '../../test/sql/subscriptionStubs.sql')

/**
 * Миграции в порядке применения: §282 (основная, автосписание), §284 (ворота
 * без подписки, наборы тем ученика и персонала), §282.2 (подписка в наборах).
 */
function migrationFiles(): string[] {
  const all = readdirSync(MIGRATIONS)
  const find = (re: RegExp) => {
    const f = all.find((x) => re.test(x))
    if (!f) throw new Error(`Не найдена миграция ${re}`)
    return path.join(MIGRATIONS, f)
  }
  return [
    find(/^\d+_subscriptions_282\.sql$/),
    find(/^\d+_subscription_renew_282\.sql$/),
    find(/^\d+_hotfix_284_gates_without_subscription\.sql$/),
    find(/^\d+_perf_284a_student_topic_sets\.sql$/),
    find(/^\d+_perf_284c_staff_topic_set\.sql$/),
    find(/^(PENDING_282_2|\d+)_subscription_sets(_282_2)?\.sql$/),
  ]
}

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), SA = U(2), SB = U(3), OLD = U(4), OTHER = U(5), SC = U(6)

let db: PGlite
const ids: Record<string, string> = {}

async function as(uid: string | null) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
}
async function one<T = Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, p)).rows[0]
}
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const row = await one<Record<string, T>>(sql, p)
  return Object.values(row)[0]
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
const access = (course: string) => val<boolean>(`select course_student_has_access($1)`, [course])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  for (const f of migrationFiles()) await db.exec(readFileSync(f, 'utf8'))

  for (const [id, role] of [[ADMIN, 'admin'], [SA, 'student'], [SB, 'student'], [OLD, 'student'], [OTHER, 'teacher'], [SC, 'student']] as const) {
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)`,
      [id, `u${id.slice(-2)}@t.ru`, `Имя${id.slice(-2)} Фамилия`, role])
  }
  ids.tpl = await val(`insert into courses (title, is_template) values ('Каркас', true) returning id`)
  ids.free = await val(`insert into courses (title) values ('Обычный') returning id`)
  ids.paid = await val(`insert into courses (title) values ('Курс с подпиской') returning id`)
  ids.gFree = await val(`insert into groups (course_id, name) values ($1, 'g') returning id`, [ids.free])
  ids.oldStudent = await val(`insert into students (profile_id) values ($1) returning id`, [OLD])
  await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [ids.gFree, ids.oldStudent])
  const m = await val<string>(`insert into modules (course_id) values ($1) returning id`, [ids.free])
  ids.tFree = await val(`insert into topics (module_id) values ($1) returning id`, [m])
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('§282 SQL: подписка', () => {
  it('без тарифов ворота доступа работают как раньше', async () => {
    await as(OLD)
    expect(await access(ids.free)).toBe(true)
    expect(await val(`select auth_is_student_of_topic($1)`, [ids.tFree])).toBe(true)
    expect(await val(`select _topic_autocheck_student_of($1, $2)`, [ids.tFree, OLD])).toBe(ids.oldStudent)
  })

  it('тариф на шаблон запрещён; флаг выключен — оформить нельзя', async () => {
    await as(ADMIN)
    expect(await errorOf(`insert into subscription_tariffs (course_id, title, price_rub) values ($1, 'x', 100)`, [ids.tpl]))
      .toContain('TARIFF_ON_TEMPLATE')
    ids.tariff = await val(
      `insert into subscription_tariffs (course_id, title, price_rub, trial_days, is_active)
       values ($1, 'Месяц', 2900, 7, true) returning id`, [ids.paid])
    await as(SA)
    expect(await errorOf(`select subscription_start_trial($1, false, false, true)`, [ids.tariff])).toContain('FLAG_OFF')
    expect(await val(`select subscription_tariffs_public()`)).toEqual([])
    await db.query(`update app_feature_flags set enabled = true where key = 'subscriptions'`)
    expect(await val<unknown[]>(`select subscription_tariffs_public()`)).toHaveLength(1)
    await as(OLD)
    expect(await access(ids.free)).toBe(true)
  })

  it('пробный период без карты: согласия, один раз, истечение закрывает без удаления из группы', async () => {
    await as(SA)
    expect(await errorOf(`select subscription_start_trial($1, true, false, true)`, [ids.tariff])).toContain('NO_PARENT_CONSENT')
    expect(await errorOf(`select subscription_start_trial($1, false, false, false)`, [ids.tariff])).toContain('NO_CONSENT')
    const trial = await val<{ subscription_id: string }>(`select subscription_start_trial($1, true, true, true)`, [ids.tariff])
    ids.subA = trial.subscription_id
    expect(await access(ids.paid)).toBe(true)
    const sa = await val<string>(`select auth_student_id()`)
    expect(await val(`select count(*)::int from group_students gs join groups g on g.id = gs.group_id where g.course_id = $1 and gs.student_id = $2`, [ids.paid, sa])).toBe(1)
    expect(await errorOf(`select subscription_start_trial($1, false, false, true)`, [ids.tariff])).toContain('TRIAL_USED')

    await db.query(`update student_subscriptions set access_until = now() - interval '1 minute' where id = $1`, [ids.subA])
    expect(await access(ids.paid)).toBe(false)
    expect(await val(`select count(*)::int from group_students where student_id = $1`, [sa])).toBe(1)
    expect(await val(`select subscription_expire_tick()`)).toBe(1)
    expect(await val(`select status from student_subscriptions where id = $1`, [ids.subA])).toBe('expired')
    expect(await val(`select my_course_access($1)`, [ids.paid])).toMatchObject({ paid: true, has_access: false, status: 'expired' })
    // окончание пробного — письмо в очередь
    expect(await val(`select count(*)::int from subscription_mail_outbox where subscription_id = $1 and kind = 'expired'`, [ids.subA])).toBe(1)
  })

  it('первая оплата с сохранением карты; сверка суммы; повтор уведомления; поиск по metadata', async () => {
    await as(null)
    const ck = await val<Record<string, unknown>>(`select subscription_checkout_begin($1, $2, true, false, false, true, null)`, [SB, ids.tariff])
    expect(Number(ck.amount_rub)).toBe(2900)
    expect(ck.receipt_email).toBe('u03@t.ru')
    ids.subB = ck.subscription_id as string
    await db.query(`select subscription_payment_attach($1, 'yk-1', 'pending', 'https://pay')`, [ck.payment_id])
    const apply = (yk: string, amount: number, our: string | null = null) =>
      val(`select subscription_apply_payment($1, $2, 'succeeded', $3, 'pm-1', true, 'Visa •4242', null, now())`, [yk, our, amount])
    expect(await apply('yk-1', 2900)).toBe('succeeded')
    expect(await apply('yk-1', 2900)).toBe('duplicate')
    const sub = await one<Record<string, unknown>>(`select * from student_subscriptions where id = $1`, [ids.subB])
    expect(sub).toMatchObject({ status: 'active', auto_renew: true, card_title: 'Visa •4242' })
    expect(+(sub.next_charge_at as Date)).toBe(+(sub.current_period_end as Date))
    expect(await val(`select count(*)::int from subscription_payments where subscription_id = $1 and status = 'succeeded'`, [ids.subB])).toBe(1)

    await as(SB)
    expect(await access(ids.paid)).toBe(true)
    const mine = await val<Array<Record<string, unknown>>>(`select my_subscriptions()`)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ can_auto_renew: true, has_access: true })

    await as(null)
    const ck2 = await val<Record<string, unknown>>(`select subscription_checkout_begin($1, $2, false, false, false, true, 'b2@t.ru')`, [SB, ids.tariff])
    expect(await apply('yk-2', 2900, ck2.payment_id as string)).toBe('succeeded')
    const after = await one<Record<string, Date>>(`select current_period_end from student_subscriptions where id = $1`, [ids.subB])
    expect(+after.current_period_end).toBeGreaterThan(+(sub.current_period_end as Date))
    expect(await apply('yk-unknown', 1)).toBe('unknown')
    // несовпадение суммы: платёж закрыт окончательно, период не продлён
    const ckm = await val<Record<string, string>>(`select subscription_checkout_begin($1, $2, false, false, false, true, null)`, [SB, ids.tariff])
    const before = await val<Date>(`select current_period_end from student_subscriptions where id = $1`, [ids.subB])
    expect(await apply('yk-m', 1, ckm.payment_id)).toBe('amount_mismatch')
    expect(await val(`select status from subscription_payments where id = $1`, [ckm.payment_id])).toBe('failed')
    expect(+(await val<Date>(`select current_period_end from student_subscriptions where id = $1`, [ids.subB]))).toBe(+before)
  })

  it('автосписание: запас 2 часа, тот же ключ при повторе, отказы → past_due с доступом → expired', async () => {
    await as(null)
    // до конца периода больше 2 часов — рано
    await db.query(`update student_subscriptions set current_period_end = now() + interval '3 hours', access_until = now() + interval '3 hours', next_charge_at = now() + interval '3 hours' where id = $1`, [ids.subB])
    expect((await db.query(`select * from subscription_renewal_due(10)`)).rows).toHaveLength(0)
    await db.query(`update student_subscriptions set current_period_end = now() + interval '1 hour', access_until = now() + interval '1 hour', next_charge_at = now() + interval '1 hour' where id = $1`, [ids.subB])
    expect((await db.query(`select * from subscription_renewal_due(10)`)).rows).toHaveLength(1)
    // автопродление включено и срок подошёл — expire_tick не трогает (статус ведёт автосписание)
    await db.query(`update student_subscriptions set access_until = now() - interval '1 minute' where id = $1`, [ids.subB])
    expect(await val(`select subscription_expire_tick()`)).toBe(0)
    await db.query(`update student_subscriptions set current_period_end = now() - interval '1 minute', access_until = now() - interval '1 minute', next_charge_at = now() - interval '1 minute' where id = $1`, [ids.subB])

    const r1 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [ids.subB])
    const r1again = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [ids.subB])
    expect(r1again.payment_id).toBe(r1.payment_id)
    expect(r1.yookassa_method_id).toBe('pm-1')
    await db.query(`select subscription_payment_attach($1, 'yk-r1', 'pending', null)`, [r1.payment_id])
    expect((await db.query(`select * from subscription_renewal_due(10)`)).rows).toHaveLength(0)

    // успешный повтор считает период от конца прежнего (проверка в транзакции с откатом)
    {
      const before = await one<Record<string, Date>>(`select current_period_end from student_subscriptions where id = $1`, [ids.subB])
      await db.exec('begin')
      // списание прошло, пока доступ ещё открыт (расписание списывает заранее)
      await db.query(`update student_subscriptions set access_until = now() + interval '1 hour' where id = $1`, [ids.subB])
      await db.query(`select subscription_apply_payment('yk-r1', null, 'succeeded', 2900, null, false, null, null, now())`)
      const s = await one<Record<string, unknown>>(`select current_period_end, status, charge_attempts from student_subscriptions where id = $1`, [ids.subB])
      const expected = await val<Date>(`select $1::timestamptz + interval '1 month'`, [before.current_period_end])
      expect(+(s.current_period_end as Date)).toBe(+expected)
      expect(s).toMatchObject({ status: 'active', charge_attempts: 0 })
      await db.exec('rollback')
    }

    expect(await val(`select subscription_apply_payment('yk-r1', null, 'canceled', 2900, null, false, null, 'insufficient_funds', null)`)).toBe('retry')
    expect(await one(`select status, charge_attempts, last_charge_error from student_subscriptions where id = $1`, [ids.subB]))
      .toMatchObject({ status: 'past_due', charge_attempts: 1, last_charge_error: 'insufficient_funds' })
    expect(await val(`select count(*)::int from subscription_mail_outbox where subscription_id = $1 and kind = 'charge_failed'`, [ids.subB])).toBe(1)
    await as(SB)
    expect(await access(ids.paid)).toBe(true)

    await as(null)
    // повтор раньше срока не создаётся; настал срок повтора — создаётся
    expect(await val(`select subscription_renewal_begin($1)`, [ids.subB])).toBeNull()
    await db.query(`update student_subscriptions set next_charge_at = now() where id = $1`, [ids.subB])
    const r2 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [ids.subB])
    expect(r2.payment_id).not.toBe(r1.payment_id)
    expect(await val(`select subscription_payment_failed($1, 'http_400')`, [r2.payment_id])).toBe('retry')
    await db.query(`update student_subscriptions set next_charge_at = now() where id = $1`, [ids.subB])
    const r3 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [ids.subB])
    await db.query(`select subscription_payment_attach($1, 'yk-r3', 'pending', null)`, [r3.payment_id])
    expect(await val(`select subscription_apply_payment('yk-r3', null, 'canceled', 2900, null, false, null, 'card_expired', null)`)).toBe('expired')
    expect(await one(`select status, auto_renew from student_subscriptions where id = $1`, [ids.subB]))
      .toMatchObject({ status: 'expired', auto_renew: false })
    await as(SB)
    expect(await access(ids.paid)).toBe(false)
    expect(await val(`select count(*)::int from notifications where user_id = $1`, [SB])).toBeGreaterThanOrEqual(4)
  })

  it('продлил — всё вернулось; возврат закрывает сразу', async () => {
    await as(null)
    const ck = await val<Record<string, string>>(`select subscription_checkout_begin($1, $2, false, false, false, true, null)`, [SB, ids.tariff])
    await db.query(`select subscription_apply_payment('yk-3', $1, 'succeeded', 2900, null, false, null, null, now())`, [ck.payment_id])
    await as(SB)
    expect(await access(ids.paid)).toBe(true)
    await as(null)
    expect(await val(`select subscription_apply_refund('yk-3', 'rf-1')`)).toBe('refunded')
    expect(await val(`select subscription_apply_refund('yk-3', 'rf-1')`)).toBe('duplicate')
    await as(SB)
    expect(await access(ids.paid)).toBe(false)
  })

  it('автопродление: ученик управляет только своей; отключение — письмо', async () => {
    await as(SB)
    expect(await errorOf(`select subscription_set_auto_renew($1, true)`, [ids.subB])).toContain('NOT_ACTIVE')
    await as(SA)
    expect(await errorOf(`select subscription_set_auto_renew($1, false)`, [ids.subB])).not.toBeNull()

    await as(ADMIN)
    await db.query(`select admin_subscription_extend($1, 30, 'тест')`, [ids.subB])
    await as(SB)
    expect(await val(`select (subscription_set_auto_renew($1, true))->>'auto_renew'`, [ids.subB])).toBe('true')
    await db.query(`select subscription_set_auto_renew($1, false)`, [ids.subB])
    expect(await one(`select auto_renew, next_charge_at from student_subscriptions where id = $1`, [ids.subB]))
      .toMatchObject({ auto_renew: false, next_charge_at: null })
    expect(await val(`select count(*)::int from subscription_mail_outbox where subscription_id = $1 and kind = 'auto_renew_off'`, [ids.subB])).toBe(1)
    // повторное «выключить» при уже выключенном — второго письма нет
    await db.query(`select subscription_set_auto_renew($1, false)`, [ids.subB])
    expect(await val(`select count(*)::int from subscription_mail_outbox where subscription_id = $1 and kind = 'auto_renew_off'`, [ids.subB])).toBe(1)
  })

  it('очередь писем: claim отдаёт адрес и данные, считает попытку; done отмечает', async () => {
    await as(null)
    const rows = (await db.query<Record<string, unknown>>(`select * from subscription_mail_claim(10)`)).rows
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const fail = rows.find((r) => r.kind === 'charge_failed')!
    expect(fail).toMatchObject({ email: 'u03@t.ru', course_title: 'Курс с подпиской' })
    expect((await db.query(`select * from subscription_mail_claim(10)`)).rows).toHaveLength(rows.length) // ещё не отмечены
    await db.query(`select subscription_mail_done($1, true, null, null)`, [fail.id])
    const skipped = rows.find((r) => r.kind === 'expired')!
    await db.query(`select subscription_mail_done($1, false, null, 'no_api_key')`, [skipped.id])
    expect(await val(`select count(*)::int from subscription_log where event = 'mail_skipped'`)).toBe(1)
    const left = (await db.query<Record<string, unknown>>(`select * from subscription_mail_claim(10)`)).rows
    expect(left.map((r) => r.id)).not.toContain(fail.id)
    expect(left.map((r) => r.id)).not.toContain(skipped.id)
  })

  it('админка: ученик отбит видимой ошибкой; продление, отмена, выдача', async () => {
    await as(SB)
    expect(await errorOf(`select admin_subscriptions(null)`)).toContain('ONLY_ADMIN')
    expect(await errorOf(`select admin_subscription_extend($1, 30, 'x')`, [ids.subB])).toContain('ONLY_ADMIN')
    await as(ADMIN)
    expect(await val<unknown[]>(`select admin_subscriptions(null)`)).toHaveLength(2)
    await db.query(`select admin_subscription_cancel($1, 'тест')`, [ids.subB])
    await as(SB)
    expect(await access(ids.paid)).toBe(false)
    await as(ADMIN)
    await db.query(`select admin_subscription_extend($1, 10, 'вернуть')`, [ids.subB])
    await as(SB)
    expect(await access(ids.paid)).toBe(true)
  })

  it('полная группа: оплативший всё равно зачислен, лимит поднят и записан', async () => {
    await as(ADMIN)
    const g = await val<string>(`select id from groups where course_id = $1`, [ids.paid])
    const cnt = await val<number>(`select count(*)::int from group_students where group_id = $1`, [g])
    await db.query(`update groups set max_students = $2 where id = $1`, [g, cnt])
    const st = await val<string>(`insert into students (profile_id) values ($1) returning id`, [OTHER])
    await db.query(`select admin_subscription_grant($1, $2, 10, 'подарок')`, [st, ids.tariff])
    expect(await val(`select count(*)::int from group_students where group_id = $1 and student_id = $2`, [g, st])).toBe(1)
    expect(await val(`select count(*)::int from subscription_log where event = 'group_capacity_raised'`)).toBe(1)
  })

  it('пробники, автопроверка и course-materials не пускают без подписки', async () => {
    await as(ADMIN)
    const g = await val<string>(`select id from groups where course_id = $1`, [ids.paid])
    const me = await val<string>(`insert into mock_exams (group_id) values ($1) returning id`, [g])
    const m = await val<string>(`insert into modules (course_id) values ($1) returning id`, [ids.paid])
    const t = await val<string>(`insert into topics (module_id) values ($1) returning id`, [m])
    await as(SA) // пробный истёк
    expect(await val(`select mock_exam_my_student_id($1)`, [me])).toBeNull()
    expect(await val(`select _topic_autocheck_student_of($1, $2)`, [t, SA])).toBeNull()
    expect(await val(`select auth_is_student_of_topic($1)`, [t])).toBe(false)
    await as(SB) // действующая
    expect(await val(`select mock_exam_my_student_id($1)`, [me])).not.toBeNull()
    expect(await val(`select auth_is_student_of_topic($1)`, [t])).toBe(true)
  })

  it('ревью: отказ банка не переоткрывает отменённую; брошенное оформление не меняет тариф; сумма; частичный возврат', async () => {
    await as(ADMIN)
    const year = await val<string>(
      `insert into subscription_tariffs (course_id, title, price_rub, period_months, is_active)
       values ($1, 'Год', 25000, 12, true) returning id`, [ids.paid])
    await as(null)
    // первая оплата месячного тарифа с картой
    const ck = await val<Record<string, string>>(`select subscription_checkout_begin($1, $2, true, false, false, true, null)`, [SC, ids.tariff])
    await db.query(`select subscription_apply_payment('yk-c1', $1, 'succeeded', 2900, 'pm-c', true, null, null, now())`, [ck.payment_id])
    const subC = ck.subscription_id
    // брошенное оформление годового: тариф подписки не меняется
    await val(`select subscription_checkout_begin($1, $2, false, false, false, true, 'other@t.ru')`, [SC, year])
    expect(await one(`select tariff_id, receipt_email from student_subscriptions where id = $1`, [subC]))
      .toMatchObject({ tariff_id: ids.tariff, receipt_email: 'u06@t.ru' })

    // автосписание висит, админ отменяет, банк отказывает — доступ НЕ возвращается
    await db.query(`update student_subscriptions set next_charge_at = now() + interval '1 hour' where id = $1`, [subC])
    const r = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [subC])
    await db.query(`select subscription_payment_attach($1, 'yk-c2', 'pending', null)`, [r.payment_id])
    await as(ADMIN)
    await db.query(`select admin_subscription_cancel($1, 'тест')`, [subC])
    await as(null)
    expect(await val(`select subscription_apply_payment('yk-c2', null, 'canceled', 2900, null, false, null, 'insufficient_funds', null)`)).toBe('skip')
    expect(await one(`select status from student_subscriptions where id = $1`, [subC])).toMatchObject({ status: 'cancelled' })
    await as(SC)
    expect(await access(ids.paid)).toBe(false)

    // вернули доступ; параллельный запуск после успешного списания второй платёж не создаёт
    await as(ADMIN)
    await db.query(`select admin_subscription_extend($1, 30, 'вернуть')`, [subC])
    await db.query(`update student_subscriptions set auto_renew = true, next_charge_at = now() + interval '1 hour' where id = $1`, [subC])
    await as(null)
    const r2 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [subC])
    await db.query(`select subscription_payment_attach($1, 'yk-c3', 'succeeded', null)`, [r2.payment_id])
    await db.query(`select subscription_apply_payment('yk-c3', null, 'succeeded', 2900, null, false, null, null, now())`)
    expect(await val(`select subscription_renewal_begin($1)`, [subC])).toBeNull()

    // несовпадение суммы на автосписании — платёж закрыт, подписка уходит в повтор
    await db.query(`update student_subscriptions set next_charge_at = now() + interval '1 hour' where id = $1`, [subC])
    const r3 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [subC])
    await db.query(`select subscription_payment_attach($1, 'yk-c4', 'pending', null)`, [r3.payment_id])
    expect(await val(`select subscription_apply_payment('yk-c4', null, 'succeeded', 1, null, false, null, null, now())`)).toBe('amount_mismatch')
    expect(await val(`select status from subscription_payments where id = $1`, [r3.payment_id])).toBe('failed')
    expect(await val(`select status from student_subscriptions where id = $1`, [subC])).toBe('past_due')

    // частичный возврат доступ не закрывает; полный — закрывает
    expect(await val(`select subscription_apply_refund('yk-c3', 'rf-c1', 100)`)).toBe('partial')
    await as(SC)
    expect(await access(ids.paid)).toBe(true)
    await as(null)
    expect(await val(`select subscription_apply_refund('yk-c3', 'rf-c2', 2900)`)).toBe('refunded')
    await as(SC)
    expect(await access(ids.paid)).toBe(false)

    // успешная оплата годового — тариф и email меняются только теперь
    await as(null)
    const ck2 = await val<Record<string, string>>(`select subscription_checkout_begin($1, $2, false, false, false, true, 'year@t.ru')`, [SC, year])
    await db.query(`select subscription_apply_payment('yk-c5', $1, 'succeeded', 25000, null, false, null, null, now())`, [ck2.payment_id])
    expect(await one(`select tariff_id, receipt_email from student_subscriptions where id = $1`, [subC]))
      .toMatchObject({ tariff_id: year, receipt_email: 'year@t.ru' })
    const mine = await (async () => { await as(SC); return val<Array<Record<string, unknown>>>(`select my_subscriptions()`) })()
    expect(mine[0]).toMatchObject({ period_months: 12 })
  })

  it('ревью: брошенная строка created старше суток не держит статус вечно', async () => {
    await as(null)
    await db.query(`update student_subscriptions set status = 'active', auto_renew = false, next_charge_at = null, access_until = now() - interval '1 minute' where id = $1`, [ids.subA])
    await db.query(`insert into subscription_payments (subscription_id, student_id, kind, amount_rub, period_months, created_at)
                    select id, student_id, 'initial', 2900, 1, now() - interval '2 days' from student_subscriptions where id = $1`, [ids.subA])
    expect(await val(`select subscription_expire_tick()`)).toBeGreaterThanOrEqual(1)
    expect(await val(`select status from student_subscriptions where id = $1`, [ids.subA])).toBe('expired')
  })
})

describe('§282.2 RLS: подписка в наборах тем ученика', () => {
  const SX = U(7)
  const TABLES = [
    'topic_material_items', 'course_lessons', 'topic_homework', 'topic_homework_files', 'topic_tests',
    'topic_test_assignments', 'topic_autocheck_tasks', 'topic_catalog_topics', 'course_study_plans', 'course_study_plan_items',
  ] as const
  const c: Record<string, string> = {}

  /** Сколько строк каждой таблицы видит пользователь под `authenticated` (RLS включён). */
  async function visible(uid: string): Promise<Record<string, number>> {
    await as(uid)
    await db.exec('set role authenticated')
    try {
      const out: Record<string, number> = {}
      for (const t of TABLES) out[t] = await val<number>(`select count(*)::int from ${t}`)
      return out
    } finally {
      await db.exec('reset role')
    }
  }
  const none = Object.fromEntries(TABLES.map((t) => [t, 0]))

  beforeAll(async () => {
    await as(null)
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, 'x@t.ru', 'Икс Иксов', 'student')`, [SX])
    c.course = await val(`insert into courses (title) values ('Платный поток') returning id`)
    c.group = await val(`insert into groups (course_id, name) values ($1, 'p') returning id`, [c.course])
    c.student = await val(`insert into students (profile_id) values ($1) returning id`, [SX])
    await db.query(`insert into group_students (group_id, student_id) values ($1, $2)`, [c.group, c.student])
    const m = await val<string>(`insert into modules (course_id) values ($1) returning id`, [c.course])
    c.open = await val(`insert into topics (module_id) values ($1) returning id`, [m])
    c.closed = await val(`insert into topics (module_id, is_open) values ($1, false) returning id`, [m])
    for (const t of [c.open, c.closed]) {
      await db.query(`insert into topic_material_items (topic_id) values ($1)`, [t])
      await db.query(`insert into course_lessons (topic_id) values ($1)`, [t])
      await db.query(`insert into topic_autocheck_tasks (topic_id) values ($1)`, [t])
      await db.query(`insert into topic_catalog_topics (topic_id) values ($1)`, [t])
      const hw = await val<string>(`insert into topic_homework (topic_id) values ($1) returning id`, [t])
      await db.query(`insert into topic_homework_files (homework_id) values ($1)`, [hw])
      const test = await val<string>(`insert into topic_tests default values returning id`)
      await db.query(`insert into topic_test_assignments (topic_id, test_id) values ($1, $2)`, [t, test])
      await db.query(`insert into course_study_plan_items (course_id, topic_id) values ($1, $2)`, [c.course, t])
    }
    await db.query(`insert into course_study_plans (course_id) values ($1)`, [c.course])
    // бесплатный курс старого ученика — для проверки, что подписка его не трогает
    await db.query(`insert into topic_material_items (topic_id) values ($1)`, [ids.tFree])
  })

  it('без тарифа: ученик видит открытую тему курса, закрытую — нет; персонал — всё', async () => {
    const seen = await visible(SX)
    // по одной строке открытой темы; план и его пункты — по курсу (2 пункта)
    expect(seen).toEqual({ ...Object.fromEntries(TABLES.map((t) => [t, 1])), course_study_plan_items: 2 })
    await as(SX)
    expect(await val(`select course_student_has_access($1)`, [c.course])).toBe(true)
    expect(await val(`select student_access_courses()`)).toContain(c.course)
    const admin = await visible(ADMIN)
    expect(admin.topic_material_items).toBe(3)
    expect(admin.topic_homework).toBe(2)
  })

  it('с тарифом и без подписки — материалы курса пусты; бесплатный курс не задет', async () => {
    await as(null)
    c.tariff = await val(`insert into subscription_tariffs (course_id, title, price_rub) values ($1, 'Поток', 1000) returning id`, [c.course])
    expect(await visible(SX)).toEqual(none)
    await as(SX)
    expect(await val(`select course_student_has_access($1)`, [c.course])).toBe(false)
    expect(await val(`select course_student_can_see_topic($1)`, [c.open])).toBe(false)
    expect(await val(`select student_access_courses()`)).not.toContain(c.course)
    expect(await val(`select count(*)::int from student_candidate_topics()`)).toBe(0)
    // ученик остаётся в группе — прогресс не теряется
    expect(await val(`select count(*)::int from group_students where student_id = $1`, [c.student])).toBe(1)
    // старый ученик бесплатного курса видит свой материал, как раньше
    expect((await visible(OLD)).topic_material_items).toBe(1)
    // персонал видит курс независимо от подписки
    expect((await visible(ADMIN)).topic_material_items).toBe(3)
  })

  it('подписка активна — всё вернулось; истекла — снова пусто', async () => {
    await as(null)
    const sub = await val<string>(
      `insert into student_subscriptions (student_id, course_id, tariff_id, status, source, access_until)
       values ($1, $2, $3, 'active', 'manual', now() + interval '30 days') returning id`, [c.student, c.course, c.tariff])
    expect(await visible(SX)).toEqual({ ...Object.fromEntries(TABLES.map((t) => [t, 1])), course_study_plan_items: 2 })
    await db.query(`update student_subscriptions set access_until = now() - interval '1 minute' where id = $1`, [sub])
    expect(await visible(SX)).toEqual(none)
  })
})
