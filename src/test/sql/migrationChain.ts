/**
 * Цепочка миграций подписки и ворот ученика для прогонов в PGlite
 * (`subscriptionSql.test.ts`, `progressUnlock.test.ts`): §282 → renew → §284 ×3
 * → §282.2 → §287 → §288 A → §288 B. PENDING-файлы находятся и после
 * переименования по версии.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

export const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
export const STUBS = path.resolve(__dirname, 'subscriptionStubs.sql')

export function migrationFiles(): string[] {
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
    find(/^(PENDING_288_a_unlock|\d+_progress_unlock_288a)\.sql$/),
    find(/^(PENDING_288_b_gates|\d+_progress_gates_288b)\.sql$/),
  ]
}
