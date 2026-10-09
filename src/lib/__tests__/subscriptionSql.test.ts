/**
 * §282 «Подписка» — логика доступа и статусов в SQL, прогон настоящих миграций
 * на PGlite (Postgres в WASM) поверх заглушек прод-объектов
 * (`src/test/sql/subscriptionStubs.sql`).
 *
 * Проверяется поведение функций, а не текст: правило доступа, пробный период,
 * оплата и её идемпотентность, автосписание с повторами, возврат, админка,
 * очередь писем. RLS здесь не проверяется (прогон под владельцем базы) — права
 * проверяются на проде под `authenticated` (см. PROJECT_STATE §282).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const STUBS = path.resolve(__dirname, '../../test/sql/subscriptionStubs.sql')

/** Миграции §282 в порядке применения: основная, затем автосписание. */
function migrationFiles(): string[] {
  const all = readdirSync(MIGRATIONS)
  const main = all.find((f) => /^\d+_subscriptions_282\.sql$/.test(f))
  const renew = all.find((f) => f.includes('282') && f.includes('renew') && f.endsWith('.sql'))
  if (!main || !renew) throw new Error(`Не найдены миграции §282: ${main} / ${renew}`)
  return [main, renew].map((f) => path.join(MIGRATIONS, f))
}

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), SA = U(2), SB = U(3), OLD = U(4), OTHER = U(5)

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

  for (const [id, role] of [[ADMIN, 'admin'], [SA, 'student'], [SB, 'student'], [OLD, 'student'], [OTHER, 'teacher']] as const) {
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
    expect(await apply('yk-1', 1)).toBe('amount_mismatch')
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
    const r2 = await val<Record<string, string>>(`select subscription_renewal_begin($1)`, [ids.subB])
    expect(r2.payment_id).not.toBe(r1.payment_id)
    expect(await val(`select subscription_payment_failed($1, 'http_400')`, [r2.payment_id])).toBe('retry')
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
})
