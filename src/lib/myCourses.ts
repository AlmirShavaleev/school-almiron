/**
 * «Мои курсы» в стиле лендинга (письмо ЛК_стиль_мои_курсы.md, 15.10).
 * Чистые правила карточки курса; сеть — в MyCoursesPage.
 *
 * Прогресс — только `student_home_courses()` (пройдено = ДЗ сдано/принято из
 * тем с ДЗ, как на главной). Прежняя карточка считала «открыто» по ВСЕМ темам
 * курса на клиенте — у курса «по прохождению» выходило 100% и «108/108».
 */
import { plural } from '@/lib/plural'
import { progressNote, type CourseTopicLocks } from '@/lib/progressUnlock'
import { DEMO_LOCK_NOTE, type PathSubscription } from '@/lib/studentPath'

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

export interface NextLesson { id: string; title: string; note: string }

/**
 * «Что дальше» (если курс один): следующие 2 закрытых урока с условием
 * открытия. Курс по прохождению — замки базы (в пробном — «Доступно по
 * подписке»); по расписанию — ближайшие темы с будущей датой.
 */
export function nextLessons(
  locks: CourseTopicLocks | null,
  dated: Array<{ id: string; title: string; available_from: string | null; is_open: boolean | null }>,
  demo: boolean,
  today: string,
): NextLesson[] {
  if (locks?.mode === 'progress') {
    return locks.topics.filter(l => !l.open).slice(0, 2).map(l => ({
      id: l.topic_id, title: l.title ?? 'Урок', note: demo ? DEMO_LOCK_NOTE : (progressNote(l, today) ?? 'Откроется позже'),
    }))
  }
  return dated
    .filter(t => t.is_open !== true && !!t.available_from && t.available_from.slice(0, 10) > today)
    .sort((a, b) => a.available_from!.localeCompare(b.available_from!))
    .slice(0, 2)
    .map(t => ({ id: t.id, title: t.title, note: `Откроется ${shortDate(t.available_from!.slice(0, 10) + 'T00:00:00+03:00')}` }))
}
