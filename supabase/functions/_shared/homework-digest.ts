/**
 * §243. Сводка «новые домашние задания» — одна карточка на ученика вместо
 * поштучных `new_homework`. Производитель — `topic_homework_digest_flush`
 * (миграция §243), payload:
 *
 *   { count, items: [{ course_title, title, due_date: 'YYYY-MM-DD' | null, link }],
 *     courses: [{ course_title, link, count }], link }
 *
 * Форма зависит от числа ДЗ (утверждено владельцем 29.09, макет §243):
 *   1     — ровно карточка `new_homework`, кнопка «Открыть задание»;
 *   2–9   — «Новые домашние задания: N» и список по курсам
 *           «Тема — до <дата> / без дедлайна»;
 *   10+   — «Открыто N новых домашних заданий», курсы через запятую,
 *           «Список — в курсе».
 * Кнопка при 2+: один курс — «Открыть курс», несколько — «Мои задания»
 * (`/my-homework`).
 *
 * Модуль чистый: без сети и базы, его гоняет vitest
 * (`src/lib/__tests__/homeworkDigestNotify.test.ts`).
 */
import { buildLinkButton, escapeHtml, formatDay } from './variant-telegram.ts'

interface DigestItem {
  course_title: string
  title: string
  due_date: string | null
  link: string | null
}

interface DigestCourse {
  course_title: string
  link: string | null
  items: DigestItem[]
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function readItems(payload: Record<string, unknown>): DigestItem[] {
  const raw = Array.isArray(payload.items) ? payload.items : []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(x => ({
      course_title: str(x.course_title),
      title: str(x.title),
      due_date: str(x.due_date) || null,
      link: str(x.link) || null,
    }))
}

/**
 * Курсы в порядке первого появления в `items` (производитель уже отсортировал
 * по курсу и порядку тем). Ссылку курса берём из `payload.courses`; если её
 * там нет — кнопки курса не будет, а не будет угаданной ссылки.
 */
function groupByCourse(items: DigestItem[], payload: Record<string, unknown>): DigestCourse[] {
  const links = new Map<string, string>()
  if (Array.isArray(payload.courses)) {
    for (const c of payload.courses as unknown[]) {
      if (c && typeof c === 'object') {
        const rec = c as Record<string, unknown>
        if (str(rec.link)) links.set(str(rec.course_title), str(rec.link))
      }
    }
  }
  const out: DigestCourse[] = []
  for (const it of items) {
    let course = out.find(c => c.course_title === it.course_title)
    if (!course) {
      course = { course_title: it.course_title, link: links.get(it.course_title) ?? null, items: [] }
      out.push(course)
    }
    course.items.push(it)
  }
  return out
}

/** «новое домашнее задание» / «новых домашних задания» / «новых домашних заданий». */
export function newHomeworkWord(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'новое домашнее задание'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'новых домашних задания'
  return 'новых домашних заданий'
}

export function buildHomeworkDigestTelegramMessage(payload: Record<string, unknown>, appUrl: string) {
  const items = readItems(payload)
  const n = items.length
  const courses = groupByCourse(items, payload)
  const esc = escapeHtml

  if (n <= 1) {
    // Слово в слово карточка `new_homework` (process-notification-queue):
    // одно ДЗ — это то же событие, что и раньше.
    const it = items[0] ?? { course_title: '', title: '', due_date: null, link: null }
    const headline = [esc(it.course_title), esc(it.title)].filter(Boolean).join(' · ')
    return {
      text:
        `📚 <b>Новое домашнее задание</b>\n\n` +
        `${headline}\n` +
        (it.due_date ? `Сдать до ${esc(formatDay(it.due_date))}` : 'Без дедлайна'),
      replyMarkup: buildLinkButton(it.link ?? (str(payload.link) || null), appUrl, 'Открыть задание'),
    }
  }

  const single = courses.length === 1
  const button = single
    ? buildLinkButton(courses[0].link ?? (str(payload.link) || null), appUrl, 'Открыть курс')
    : buildLinkButton('/my-homework', appUrl, 'Мои задания')

  if (n < 10) {
    const blocks = courses.map(c =>
      [
        ...(c.course_title ? [`<b>${esc(c.course_title)}</b>`] : []),
        ...c.items.map(it =>
          `• ${esc(it.title || 'Домашнее задание')} — ` +
          (it.due_date ? `до ${esc(formatDay(it.due_date))}` : 'без дедлайна')),
      ].join('\n'))
    return {
      text: `📚 <b>Новые домашние задания: ${n}</b>\n\n` + blocks.join('\n\n'),
      replyMarkup: button,
    }
  }

  const names = courses.map(c => c.course_title).filter(Boolean).map(esc).join(', ')
  return {
    text:
      `📚 <b>Открыто ${n} ${newHomeworkWord(n)}</b>\n\n` +
      (names ? `${names}\n` : '') +
      'Список — в курсе',
    replyMarkup: button,
  }
}
