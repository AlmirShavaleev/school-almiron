import { supabase } from '@/lib/supabase'

/**
 * Две колонки списка учеников, которых нет в `get_my_students`: привязка
 * Telegram и последняя сдача.
 *
 * Обе грузятся ОТДЕЛЬНО и после основного списка — намеренно. Список должен
 * появляться сразу, а эти колонки дорисовываются: ученик без них читается,
 * пустая страница — нет.
 */

/** Ключ — `students.id`. Отсутствие ключа значит «нет данных», а не «нет привязки». */
export type TelegramFlags = Record<string, boolean>

/** Ключ — `students.id`, значение — ISO-время последней сдачи. */
export type LastSubmissions = Record<string, string>

/** По сколько id спрашиваем за раз: длинный `.in()` рвёт URL (см. useVariants). */
const CHUNK = 50

function chunked<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/**
 * Флаг привязки Telegram по ученикам. Через definer-RPC: политики
 * `telegram_connections` пускают только к своей строке или платформенного
 * админа, поэтому преподаватель прочитать таблицу не может. RPC отдаёт ровно
 * boolean и только по тем ученикам, которых вызывающий вправе видеть.
 */
export async function fetchTelegramFlags(studentIds: string[]): Promise<TelegramFlags> {
  if (studentIds.length === 0) return {}
  const db = supabase as any
  const flags: TelegramFlags = {}

  for (const chunk of chunked(studentIds)) {
    const { data, error } = await db.rpc('students_telegram_flags', { p_student_ids: chunk })
    // Колонка необязательная: молча оставляем прочерк, а не роняем список.
    if (error) continue
    for (const row of (Array.isArray(data) ? data : []) as any[]) {
      if (row?.student_id) flags[String(row.student_id)] = Boolean(row.telegram_linked)
    }
  }
  return flags
}

/**
 * Время последней сдачи ДЗ по ученикам.
 *
 * Считаем на клиенте по максимуму `submitted_at`, а не запросом с группировкой:
 * PostgREST не умеет `group by` без вью, а заводить вью ради одной колонки
 * дороже, чем сложить 16 строк в объект. Видимость держит RLS
 * (`topic_homework_attempts_select`), поэтому в режиме учителя сюда доедут
 * только сдачи его курсов.
 */
export async function fetchLastSubmissions(studentIds: string[]): Promise<LastSubmissions> {
  if (studentIds.length === 0) return {}
  const last: LastSubmissions = {}

  for (const chunk of chunked(studentIds)) {
    const { data, error } = await supabase
      .from('topic_homework_attempts')
      .select('student_id, submitted_at')
      .in('student_id', chunk)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
    if (error) continue
    for (const row of (data ?? []) as Array<{ student_id: string | null; submitted_at: string | null }>) {
      if (!row.student_id || !row.submitted_at) continue
      const current = last[row.student_id]
      if (!current || row.submitted_at > current) last[row.student_id] = row.submitted_at
    }
  }
  return last
}

/**
 * Относительная дата для колонки активности: «сегодня», «вчера», «3 дня
 * назад». Дальше недели — обычная дата: «12 дней назад» уже не читается
 * быстрее, чем «23.07.2026».
 */
export function formatRelativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'нет сдач'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'нет сдач'

  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(then)) / 86400000)

  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${pluralDays(days)} назад`
  return then.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function pluralDays(n: number): string {
  if (n >= 2 && n <= 4) return 'дня'
  return 'дней'
}
