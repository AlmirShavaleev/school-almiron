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
 * без подписки, наборы тем ученика и персонала), §282.2 (подписка в наборах),
 * §287 (промокоды, режим тестировщиков).
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
    find(/^(PENDING_287|\d+)_promo_testers(_287)?\.sql$/),
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
    // §287: по умолчанию — только тестировщики; «для всех» включается отдельно
    expect(await val(`select subscription_tariffs_public()`)).toEqual([])
    await db.query(`update subscription_settings set audience = 'everyone'`)
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

describe('§287 промокоды и режим тестировщиков', () => {
  const P = Array.from({ length: 12 }, (_, i) => U(100 + i))
  const t: Record<string, string> = {}

  type Begin = Record<string, unknown> & { payment_id?: string; amount_rub?: number | string; error_code?: string; free?: boolean }
  const begin = async (profile: string, code: string | null, tariff = t.tariff) => {
    await as(null)
    return val<Begin>(`select subscription_checkout_begin($1, $2, true, false, false, true, null, $3)`, [profile, tariff, code])
  }
  const paid = async (paymentId: string, amount: number, yk = `yk-${paymentId.slice(0, 8)}`) => {
    await as(null)
    return val(`select subscription_apply_payment($1, $2, 'succeeded', $3, $4, true, 'Visa •1111', null, now())`,
      [yk, paymentId, amount, `pm-${paymentId.slice(0, 8)}`])
  }
  const check = async (profile: string, code: string) => {
    await as(profile)
    return val<Record<string, unknown>>(`select subscription_promo_check($1, $2)`, [t.tariff, code])
  }
  const createCode = async (p: Record<string, unknown>) => {
    await as(ADMIN)
    const r = await val<{ codes: string[] }>(`select admin_promo_create($1::jsonb)`, [JSON.stringify(p)])
    return r.codes[0]
  }
  const subOf = (profile: string) => one<Record<string, unknown>>(
    `select s.* from student_subscriptions s join students st on st.id = s.student_id
      where st.profile_id = $1 and s.course_id = $2`, [profile, t.course])
  const redemption = (code: string, profile: string) => one<Record<string, unknown>>(
    `select r.* from subscription_promo_redemptions r join subscription_promo_codes c on c.id = r.code_id
      where c.code = $1 and r.profile_id = $2`, [code, profile])
  const usedCount = (code: string) => val<number>(`select used_count from subscription_promo_codes where code = $1`, [code])
  const dueNow = async (profile: string) => {
    const s = await subOf(profile)
    await db.query(`update student_subscriptions set next_charge_at = now() where id = $1`, [s.id])
    return s.id as string
  }
  const renew = (subId: unknown) => val<Record<string, unknown> | null>(`select subscription_renewal_begin($1)`, [subId])

  beforeAll(async () => {
    await as(null)
    for (const [i, id] of P.entries()) {
      await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, 'student')`,
        [id, `p${i}@t.ru`, `Промо${i} Ученик`])
    }
    t.course = await val(`insert into courses (title) values ('Тестовый курс 287') returning id`)
    t.other = await val(`insert into courses (title) values ('Другой курс 287') returning id`)
    t.tariff = await val(`insert into subscription_tariffs (course_id, title, price_rub, period_months, is_active)
                          values ($1, 'Месяц 287', 1000, 1, true) returning id`, [t.course])
    await db.query(`update app_feature_flags set enabled = true where key = 'subscriptions'`)
    await db.query(`update subscription_settings set audience = 'everyone'`)
  })

  it('режим testers и off: обычному ученику — ничего, и одинаково; тестировщику — всё', async () => {
    const TESTER = P[10], PLAIN = P[11]
    await as(null)
    await db.query(`insert into subscription_testers (profile_id) values ($1)`, [TESTER])
    /** Всё, что обычный ученик может узнать или сделать с подпиской. */
    const snapshot = async (profile: string) => {
      await as(profile)
      const enabled = await val(`select subscription_enabled()`)
      const tariffs = await val(`select subscription_tariffs_public()`)
      const check = await errorOf(`select subscription_promo_check($1, 'ANYCODE1')`, [t.tariff])
      const trial = await errorOf(`select subscription_start_trial($1, false, false, true)`, [t.tariff])
      const checkout = await errorOf(`select subscription_checkout_begin($1, $2, false, false, false, true, null, null)`, [profile, t.tariff])
      await as(OLD)
      const oldAccess = await access(ids.free)
      return { enabled, tariffs, check, trial, checkout, oldAccess }
    }
    await db.query(`update app_feature_flags set enabled = false where key = 'subscriptions'`)
    const off = await snapshot(PLAIN)
    await as(null)
    await db.query(`update app_feature_flags set enabled = true where key = 'subscriptions'`)
    await db.query(`update subscription_settings set audience = 'testers'`)
    const testers = await snapshot(PLAIN)
    expect(testers).toEqual(off)
    expect(off).toMatchObject({ enabled: false, tariffs: [], oldAccess: true })
    expect(off.checkout).toContain('FLAG_OFF')
    expect(off.check).toContain('FLAG_OFF')
    expect(off.trial).toContain('FLAG_OFF')
    // тестировщик видит витрину и может оформить
    await as(TESTER)
    expect(await val(`select subscription_enabled()`)).toBe(true)
    expect((await val<unknown[]>(`select subscription_tariffs_public()`)).length).toBeGreaterThan(0)
    expect((await begin(TESTER, null)).payment_id).toBeTruthy()
    // аноним при testers — как при off
    await as(null)
    expect(await val(`select subscription_tariffs_public()`)).toEqual([])
    await db.query(`update subscription_settings set audience = 'everyone'`)
  })

  it('скидка % только на первый платёж: в ЮKassa уходит сумма со скидкой, автосписание — полная цена', async () => {
    const code = await createCode({ kind: 'percent', percent: 30, discount_payments: 1, code: 'first30' })
    expect(code).toBe('FIRST30')
    // ввод без учёта регистра и пробелов, расчёт — на сервере
    expect(await check(P[0], ' first30 ')).toMatchObject({ ok: true, kind: 'percent', amount_rub: 700, price_rub: 1000 })
    const b = await begin(P[0], 'First30')
    expect(Number(b.amount_rub)).toBe(700)
    expect(b.description).toContain('скидка 30 %')
    expect(await usedCount('FIRST30')).toBe(1)
    // слот «платёж со скидкой» взят при создании платежа
    expect(await redemption('FIRST30', P[0])).toMatchObject({ status: 'reserved', payments_left: 0 })
    expect(await paid(b.payment_id!, 700)).toBe('succeeded')
    expect(await redemption('FIRST30', P[0])).toMatchObject({ status: 'applied', payments_left: 0 })
    expect(Number((await redemption('FIRST30', P[0])).saved_rub)).toBe(300)
    await dueNow(P[0])
    const r = await renew((await subOf(P[0])).id)
    expect(Number(r!.amount_rub)).toBe(1000)
    // журнал: резерв и платёж со скидкой
    expect(await val(`select count(*)::int from subscription_log where event in ('promo_reserved','promo_payment')
                       and details->>'redemption_id' = $1`, [(await redemption('FIRST30', P[0])).id])).toBe(2)
  })

  it('скидка % на 3 платежа подряд, включая автопродления; 4-й — полная цена', async () => {
    await createCode({ kind: 'percent', percent: 50, discount_payments: 3, code: 'HALF3' })
    const b = await begin(P[1], 'half3')
    expect(Number(b.amount_rub)).toBe(500)
    await paid(b.payment_id!, 500)
    const subId = (await subOf(P[1])).id
    for (const expected of [500, 500, 1000]) {
      await dueNow(P[1])
      const r = await renew(subId)
      expect(Number(r!.amount_rub)).toBe(expected)
      expect(await paid(r!.payment_id as string, expected)).toBe('succeeded')
    }
    expect(await redemption('HALF3', P[1])).toMatchObject({ payments_left: 0 })
    expect(Number((await redemption('HALF3', P[1])).saved_rub)).toBe(1500)
  })

  it('скидка 100 % на 2 платежа: без платежа и без карты; автопродление со 100 % — без списания', async () => {
    await createCode({ kind: 'percent', percent: 100, discount_payments: 2, code: 'FULL2' })
    expect(await check(P[2], 'FULL2')).toMatchObject({ ok: true, amount_rub: 0, free: true })
    const b = await begin(P[2], 'FULL2')
    expect(b.free).toBe(true)
    expect(b.payment_id).toBeUndefined()
    expect(await val(`select count(*)::int from subscription_payments p join student_subscriptions s on s.id = p.subscription_id
                       join students st on st.id = s.student_id where st.profile_id = $1`, [P[2]])).toBe(0)
    const s1 = await subOf(P[2])
    expect(s1).toMatchObject({ status: 'active' })
    expect(await redemption('FULL2', P[2])).toMatchObject({ status: 'applied', payments_left: 1 })
    // второй бесплатный период — автопродлением (карта сохранена отдельно)
    await db.query(`insert into subscription_payment_methods (subscription_id, yookassa_method_id) values ($1, 'pm-full2')`, [s1.id])
    await db.query(`update student_subscriptions set auto_renew = true where id = $1`, [s1.id])
    await dueNow(P[2])
    expect(await renew(s1.id)).toBeNull()
    const s2 = await subOf(P[2])
    expect(+(s2.access_until as Date)).toBeGreaterThan(+(s1.access_until as Date))
    expect(await redemption('FULL2', P[2])).toMatchObject({ payments_left: 0 })
    expect(await val(`select count(*)::int from subscription_log where subscription_id = $1 and event = 'promo_free_renewal'`, [s1.id])).toBe(1)
    // третий — уже за деньги
    await dueNow(P[2])
    expect(Number((await renew(s1.id))!.amount_rub)).toBe(1000)
  })

  it('бесплатные дни и бесплатные месяцы: доступ без платежа и без карты', async () => {
    await createCode({ kind: 'free_days', free_days: 10, code: 'DAYS10' })
    await createCode({ kind: 'free_months', free_months: 2, code: 'BLOG2M' })
    const d = await begin(P[3], 'days10')
    expect(d.free).toBe(true)
    const sd = await subOf(P[3])
    expect(sd.status).toBe('trial')
    const days = (+(sd.access_until as Date) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(9.9)
    expect(days).toBeLessThan(10.1)
    await as(P[3])
    expect(await access(t.course)).toBe(true)

    const m = await begin(P[4], 'BLOG2M')
    expect(m.free).toBe(true)
    const sm = await subOf(P[4])
    expect(sm).toMatchObject({ status: 'active', auto_renew: false })
    const span = (+(sm.access_until as Date) - Date.now()) / 86_400_000
    expect(span).toBeGreaterThan(58)
    expect(span).toBeLessThan(63)
    expect(Number((await redemption('BLOG2M', P[4])).saved_rub)).toBe(2000)
  })

  it('отказы: лимит, даты, курс, выключен, один раз на ученика — один и тот же ответ; причина в журнале', async () => {
    await createCode({ kind: 'percent', percent: 10, max_uses: 1, code: 'ONCE' })
    await createCode({ kind: 'percent', percent: 10, code: 'OLDONE', valid_until: '2020-01-01T00:00:00Z' })
    await createCode({ kind: 'percent', percent: 10, code: 'LATER', valid_from: '2099-01-01T00:00:00Z' })
    await createCode({ kind: 'percent', percent: 10, code: 'OTHERC', course_id: t.other })
    const off = await createCode({ kind: 'percent', percent: 10, code: 'OFFCODE' })
    await as(ADMIN)
    await db.query(`select admin_promo_set_active((select id from subscription_promo_codes where code = $1), false)`, [off])

    expect((await begin(P[5], 'ONCE')).payment_id).toBeTruthy()
    const answers = [
      await begin(P[6], 'ONCE'), await begin(P[6], 'OLDONE'), await begin(P[6], 'LATER'),
      await begin(P[6], 'OTHERC'), await begin(P[6], 'OFFCODE'), await begin(P[6], 'NOSUCH1'),
      await begin(P[1], 'HALF3'),
    ]
    for (const a of answers) expect(a).toEqual({ ok: false, error_code: 'PROMO_INVALID', error: 'Промокод не подходит' })
    const reasons = await db.query<{ r: string }>(
      `select details->>'reason' r from subscription_log where event = 'promo_rejected' and actor = $1 order by id`, [P[6]])
    expect(reasons.rows.map((x) => x.r)).toEqual(['limit', 'expired', 'not_started', 'wrong_course', 'inactive', 'not_found'])
    expect(await val(`select details->>'reason' from subscription_log where event = 'promo_rejected' and actor = $1 order by id desc limit 1`, [P[1]]))
      .toBe('already_used')
    expect(await usedCount('ONCE')).toBe(1)
  })

  it('брошенная оплата: пока первая не закончилась — второй платёж со скидкой не создаётся; отказ ЮKassa возвращает код', async () => {
    await createCode({ kind: 'percent', percent: 20, max_uses: 1, code: 'SOLO' })
    const a = await begin(P[7], 'SOLO')
    expect(Number(a.amount_rub)).toBe(800)
    // вторая вкладка: одна скидка не оплатит два платежа (ревью §287, находка 1)
    expect(await begin(P[7], 'solo')).toMatchObject({ ok: false, error_code: 'PROMO_BUSY' })
    expect(await usedCount('SOLO')).toBe(1)
    expect((await begin(P[8], 'SOLO')).error_code).toBe('PROMO_INVALID')
    // ЮKassa отменила неоплаченный — резерв снят, код свободен
    await as(null)
    await db.query(`select subscription_apply_payment('yk-solo-a', $1, 'canceled', null, null, false, null, 'expired_on_confirmation', null)`, [a.payment_id])
    expect(await usedCount('SOLO')).toBe(0)
    expect(await redemption('SOLO', P[7])).toBeUndefined()
    // снова можно: тот же ученик берёт резерв, повторный ввод после отказа запроса — тот же резерв
    const b = await begin(P[7], 'SOLO')
    await as(null)
    await db.query(`select subscription_payment_failed($1, 'http_400')`, [b.payment_id])
    expect(await usedCount('SOLO')).toBe(0)
    expect((await begin(P[8], 'SOLO')).payment_id).toBeTruthy()
    expect(await usedCount('SOLO')).toBe(1)
  })

  it('резерв кода на одном курсе не переезжает на другой (ревью §287, находка 3)', async () => {
    const otherTariff = await val<string>(`insert into subscription_tariffs (course_id, title, price_rub, period_months, is_active)
                                           values ($1, 'Другой 287', 500, 1, true) returning id`, [t.other])
    await createCode({ kind: 'percent', percent: 10, code: 'ANYCOURSE' })
    expect((await begin(P[9], 'ANYCOURSE')).payment_id).toBeTruthy()
    expect(await begin(P[9], 'ANYCOURSE', otherTariff)).toMatchObject({ ok: false, error_code: 'PROMO_INVALID' })
    expect(await val(`select details->>'reason' from subscription_log where event = 'promo_rejected' and actor = $1 order by id desc limit 1`, [P[9]]))
      .toBe('reserved_elsewhere')
  })

  it('зависший платёж created старше суток освобождает резерв при обходе статусов (находка 4)', async () => {
    await createCode({ kind: 'percent', percent: 10, max_uses: 1, code: 'STALE1' })
    const a = await begin(P[3], 'STALE1')
    expect(await usedCount('STALE1')).toBe(1)
    await db.query(`update subscription_payments set created_at = now() - interval '2 days' where id = $1`, [a.payment_id])
    await as(null)
    await db.query(`select subscription_expire_tick()`)
    expect(await usedCount('STALE1')).toBe(0)
    expect(await val(`select promo_redemption_id from subscription_payments where id = $1`, [a.payment_id])).toBeNull()
    // второй обход ничего не возвращает повторно
    await db.query(`select subscription_expire_tick()`)
    expect(await usedCount('STALE1')).toBe(0)
  })

  it('перебор: после 10 неудачных попыток за 15 минут — отказ даже верному коду', async () => {
    await createCode({ kind: 'percent', percent: 15, code: 'GOODONE' })
    for (let i = 0; i < 10; i++) {
      expect(await check(P[9], `WRONG${i}X`)).toMatchObject({ ok: false, error_code: 'PROMO_INVALID' })
    }
    expect(await check(P[9], 'GOODONE')).toMatchObject({ ok: false, error_code: 'RATE_LIMIT' })
    expect((await begin(P[9], 'GOODONE')).error_code).toBe('RATE_LIMIT')
    await as(null)
    expect(await val(`select count(*)::int from subscription_promo_attempts where profile_id = $1 and not ok`, [P[9]])).toBe(10)
    // окно прошло — снова можно
    await db.query(`update subscription_promo_attempts set created_at = now() - interval '20 minutes' where profile_id = $1`, [P[9]])
    expect(await check(P[9], 'GOODONE')).toMatchObject({ ok: true, amount_rub: 850 })
  })

  it('админка: пачка уникальных кодов, только админ; погашения со сэкономленной суммой; ученику таблицы не видны', async () => {
    await as(P[0])
    expect(await errorOf(`select admin_promo_create('{"kind":"percent","percent":5}'::jsonb)`)).toContain('ONLY_ADMIN')
    expect(await errorOf(`select admin_promo_codes()`)).toContain('ONLY_ADMIN')
    await as(ADMIN)
    const r = await val<{ codes: string[]; batch: string }>(
      `select admin_promo_create('{"kind":"free_months","free_months":1,"count":25,"prefix":"olymp","max_uses":1}'::jsonb)`)
    expect(r.codes).toHaveLength(25)
    expect(new Set(r.codes).size).toBe(25)
    for (const c of r.codes) expect(c).toMatch(/^OLYMP-[A-HJ-NP-Z2-9]{10}$/)
    expect(await errorOf(`select admin_promo_create('{"kind":"percent","percent":5,"code":"FIRST30"}'::jsonb)`)).toContain('PROMO_EXISTS')
    const red = await val<Array<Record<string, unknown>>>(`select admin_promo_redemptions(null)`)
    expect(red.find((x) => x.code === 'FIRST30')).toMatchObject({ email: 'p0@t.ru', status: 'applied' })
    const codes = await val<Array<Record<string, unknown>>>(`select admin_promo_codes()`)
    expect(Number(codes.find((x) => x.code === 'HALF3')!.saved_total_rub)).toBe(1500)
    await as(P[0])
    await db.exec('set role authenticated')
    try {
      expect(await val(`select count(*)::int from subscription_promo_codes`)).toBe(0)
      expect(await val(`select count(*)::int from subscription_promo_redemptions`)).toBe(0)
      expect(await errorOf(`select count(*) from subscription_promo_attempts`)).toContain('permission denied')
      expect(await errorOf(`select count(*) from subscription_testers`)).toBeNull()
      expect(await val(`select count(*)::int from subscription_testers`)).toBe(0)
    } finally {
      await db.exec('reset role')
    }
  })

  it('«Моя подписка» показывает действующую скидку; новый код при ней — PROMO_ACTIVE (в журнал); ручная оплата — со скидкой', async () => {
    await createCode({ kind: 'percent', percent: 40, discount_payments: 2, code: 'FORTY2' })
    const c = await begin(P[11], 'FORTY2')
    await paid(c.payment_id!, 600)
    await as(P[11])
    const mine = await val<Array<Record<string, unknown>>>(`select my_subscriptions()`)
    const s = mine.find((x) => x.course_id === t.course)!
    expect(s.promo).toEqual({ percent: 40, payments_left: 1, next_amount_rub: 600 })
    expect((s.payments as Array<Record<string, unknown>>)[0]).toMatchObject({ discount_rub: 400 })
    // при действующей скидке новый код не принимается — ещё на «Применить», и это в журнале
    expect(await check(P[11], 'GOODONE')).toMatchObject({ ok: false, error_code: 'PROMO_ACTIVE' })
    expect((await begin(P[11], 'GOODONE')).error_code).toBe('PROMO_ACTIVE')
    expect(await val(`select count(*)::int from subscription_log where event = 'promo_rejected' and actor = $1
                       and details->>'reason' = 'promo_active'`, [P[11]])).toBe(2)
    // ручная оплата следующего периода — со скидкой; вторая параллельно — уже полная цена
    expect(Number((await begin(P[11], null)).amount_rub)).toBe(600)
    expect(Number((await begin(P[11], null)).amount_rub)).toBe(1000)
  })

  it('скидка не переезжает на другой тариф того же курса; отказ автосписания возвращает слот (находка 2)', async () => {
    const year = await val<string>(`insert into subscription_tariffs (course_id, title, price_rub, period_months, is_active)
                                    values ($1, 'Год 287', 10000, 12, true) returning id`, [t.course])
    await createCode({ kind: 'percent', percent: 50, discount_payments: 3, code: 'MONTHONLY' })
    const a = await begin(P[8], 'MONTHONLY')
    expect(Number(a.amount_rub)).toBe(500)
    await paid(a.payment_id!, 500)
    // год без кода — полная цена, хотя по месяцу остались платежи со скидкой
    expect(Number((await begin(P[8], null, year)).amount_rub)).toBe(10000)
    // автосписание месяца — со скидкой; банк отказал — слот вернулся, повтор снова со скидкой
    const subId = await dueNow(P[8])
    const r1 = await renew(subId)
    expect(Number(r1!.amount_rub)).toBe(500)
    expect(await redemption('MONTHONLY', P[8])).toMatchObject({ payments_left: 1 })
    await as(null)
    await db.query(`select subscription_apply_payment('yk-mo-1', $1, 'canceled', null, null, false, null, 'insufficient_funds', null)`, [r1!.payment_id])
    expect(await redemption('MONTHONLY', P[8])).toMatchObject({ payments_left: 2 })
    await dueNow(P[8])
    expect(Number((await renew(subId))!.amount_rub)).toBe(500)
  })
})
