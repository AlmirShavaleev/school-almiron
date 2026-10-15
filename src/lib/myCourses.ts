/**
 * «Мои курсы» в стиле лендинга (письмо ЛК_стиль_мои_курсы.md, 15.10).
 * Чистые правила карточки курса; сеть — в MyCoursesPage.
 *
 * Прогресс — только `student_home_courses()` (пройдено = ДЗ сдано/принято из
 * тем с ДЗ, как на главной). Прежняя карточка считала «открыто» по ВСЕМ темам
 * курса на клиенте — у курса «по прохождению» выходило 100% и «108/108».
 */
import { plural } from '@/lib/plural'
import type { PathSubscription } from '@/lib/studentPath'

const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
const DAY = 86_400_000

/** «17 нояб.» по московской дате момента. */
export function shortDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export type AccessKind = 'subscription' | 'trial' | 'expired' | 'school'

export interface AccessLine {
  kind: AccessKind
  text: string
  /** Кнопка рядом: оформить / продлить / «Моя подписка». */
  action: { label: string; to: string; primary: boolean } | null
}

/**
 * Строка доступа по типу курса: подписка — «до … · автопродление вкл/выкл»;
 * пробный — «осталось N дней» и «Оформить подписку»; истекла — «Доступ
 * закончился …» и «Продлить»; иначе школьная группа (без цены и сроков).
 */
export function accessLine(
  sub: PathSubscription | null | undefined,
  school: { teacher: string | null; group: string },
  now: number = Date.now(),
): AccessLine {
  if (sub) {
    const until = sub.access_until
    const checkout = `/subscribe/checkout/${sub.tariff_id}`
    const ended = sub.status === 'expired' || (sub.status === 'cancelled' && (!until || Date.parse(until) <= now))
    if (!sub.has_access || ended) {
      return {
        kind: 'expired',
        text: until ? `Доступ закончился ${shortDate(until)}` : 'Доступ закончился',
        action: { label: 'Продлить', to: checkout, primary: true },
      }
    }
    if (sub.status === 'trial') {
      const days = until ? Math.max(0, Math.ceil((Date.parse(until) - now) / DAY)) : null
      return {
        kind: 'trial',
        text: days == null ? 'Пробный период' : `Пробный период · осталось ${days} ${plural(days, 'день', 'дня', 'дней')}`,
        action: { label: 'Оформить подписку', to: checkout, primary: true },
      }
    }
    return {
      kind: 'subscription',
      text: `Подписка${until ? ` до ${shortDate(until)}` : ''} · автопродление ${sub.auto_renew ? 'вкл' : 'выкл'}`,
      action: { label: 'Моя подписка', to: '/my-subscription', primary: false },
    }
  }
  return { kind: 'school', text: `Школьная группа · ${school.teacher ?? school.group}`, action: null }
}

/** Публичное название курса: с витрины, иначе без служебных пометок «(тест)», «(новый)». */
export function publicTitle(courseTitle: string, showcaseTitle: string | null | undefined): string {
  if (showcaseTitle && showcaseTitle.trim()) return showcaseTitle.trim()
  return courseTitle.replace(/\s*\((?:тест|новый|test|копия)[^)]*\)/gi, '').replace(/\s+—\s*$/, '').trim() || courseTitle
}

// ── Прогресс курса, вариант «Б» (письмо ЛК_стиль_мои_курсы_прогресс_Б.md) ──

export interface LadderStep {
  moduleId: string
  title: string
  done: number
  /** Открыто тем с ДЗ (включая пройденные). */
  open: number
  total: number
  /** Есть открытые непройденные — «текущий» раздел (название синим). */
  current: boolean
  /** Ничего не открыто и не пройдено — будущий раздел (серым). */
  future: boolean
  complete: boolean
}

export interface CourseLadder {
  done: number
  total: number
  /** Открыто тем с ДЗ; null — не узнали (строку «можно делать» не показываем). */
  open: number | null
  donePct: number
  openPct: number | null
  /** Можно делать сейчас: открыто, но не пройдено. */
  available: number | null
  steps: LadderStep[]
}

/**
 * Кольцо и лестница разделов. Пройдено/всего — `student_home_courses()`
 * (темы с ДЗ). Открыто — темы с ДЗ, которые база отдаёт ученику
 * (`topic_homework` под политикой видимых тем): та же единица счёта, поэтому
 * «открыто» не меньше «пройдено» и не больше «всего».
 */
export function courseLadder(
  modules: Array<{ moduleId: string; title: string; done: number; total: number }>,
  openByModule: Map<string, number> | null,
  done: number,
  total: number,
): CourseLadder {
  const steps = modules.filter(m => m.total > 0).map<LadderStep>(m => {
    const open = openByModule ? Math.min(m.total, Math.max(m.done, openByModule.get(m.moduleId) ?? 0)) : m.done
    const complete = m.done >= m.total
    return {
      moduleId: m.moduleId, title: m.title, done: m.done, open, total: m.total, complete,
      current: !complete && open > m.done,
      future: !complete && open === 0 && m.done === 0,
    }
  })
  const open = openByModule ? steps.reduce((s, x) => s + x.open, 0) : null
  const pct = (n: number) => (total > 0 ? Math.round((Math.min(n, total) / total) * 100) : 0)
  return {
    done, total, open,
    donePct: pct(done),
    openPct: open == null ? null : pct(Math.max(open, done)),
    available: open == null ? null : Math.max(0, open - steps.reduce((s, x) => s + x.done, 0)),
    steps,
  }
}

/**
 * Какие разделы показать сразу: до 6 — все; больше — текущий (первый с
 * открытыми непройденными, иначе первый незавершённый) и 2 соседних.
 */
export function visibleSteps(steps: LadderStep[]): { shown: LadderStep[]; hidden: number } {
  if (steps.length <= 6) return { shown: steps, hidden: 0 }
  let at = steps.findIndex(s => s.current)
  if (at === -1) at = Math.max(0, steps.findIndex(s => !s.complete))
  const from = Math.max(0, Math.min(at - 1, steps.length - 3))
  const shown = steps.slice(from, from + 3)
  return { shown, hidden: steps.length - shown.length }
}
