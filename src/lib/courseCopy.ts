import { supabase } from '@/lib/supabase'

/**
 * Копирование курса и отдельной темы — клиентская половина.
 *
 * Почему это не одна RPC. Файлы материалов лежат в Storage, и скопировать
 * объект изнутри Postgres нельзя. Поэтому копирование идёт в три фазы:
 *
 *   1. stage    — база создаёт курс/тему со всем наполнением и возвращает
 *                 список объектов, которые надо продублировать;
 *   2. copy     — этот модуль копирует объекты внутри хранилища (server-side,
 *                 без скачивания к клиенту);
 *   3. finalize — задание закрывается. Если фаза 2 сорвалась, вызывается
 *                 rollback: половина курса со ссылками на несуществующие
 *                 файлы хуже, чем ничего — преподаватель будет думать, что
 *                 материалы на месте, и обнаружит пустоту в худший момент.
 *
 * Пути новых объектов строит база, и первый сегмент там — id новой темы.
 * Это не косметика: RLS на storage.objects разбирает именно первый сегмент
 * как id темы, и путь другого вида молча лишит преподавателя доступа.
 */

/** Что делать с датами: очистить, оставить как есть, сдвинуть на N дней. */
export type CopyDateMode = 'clear' | 'keep' | 'shift'

export interface CopyFile {
  bucket: string
  from: string
  to: string
}

export interface CopyPlan {
  jobId: string
  files: CopyFile[]
  /** Появляется при копировании курса. */
  courseId?: string
  /** Появляется при копировании темы. */
  topicId?: string
}

export interface CopyProgress {
  copied: number
  total: number
}

/**
 * Сколько дней между двумя датами в формате YYYY-MM-DD.
 *
 * Считаем в UTC-полночи: сравнение локальных дат ломается на переходе
 * зимнего времени — сутки в такой день длятся 23 или 25 часов, и деление
 * на 24 даёт дробь, которая потом округляется не в ту сторону.
 */
export function shiftDaysBetween(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Человеческое описание того, что произойдёт с датами. Нужно в диалоге:
 * «сдвинуть» без числа дней выглядит как обещание неизвестно чего.
 */
export function describeDateMode(mode: CopyDateMode, shiftDays: number): string {
  if (mode === 'clear') return 'Все даты будут очищены — расставите заново'
  if (mode === 'keep') return 'Даты останутся прежними'
  if (shiftDays === 0) return 'Даты останутся прежними: сдвиг равен нулю'
  const days = Math.abs(shiftDays)
  const direction = shiftDays > 0 ? 'вперёд' : 'назад'
  return `Все даты сдвинутся ${direction} на ${days} ${pluralDays(days)}`
}

/** «1 день / 2 дня / 5 дней» — иначе подпись в диалоге читается как машинная. */
export function pluralDays(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'дней'
  switch (n % 10) {
    case 1: return 'день'
    case 2:
    case 3:
    case 4: return 'дня'
    default: return 'дней'
  }
}

/** Название копии по умолчанию. Пустое имя база подставит сама, но в поле ввода нужен текст. */
export function defaultCopyTitle(sourceTitle: string): string {
  return `${sourceTitle} (копия)`.slice(0, 200)
}

/**
 * Фаза 2: дублирование объектов в хранилище.
 *
 * Копируем по одному, а не пачкой: Storage не умеет батч-копирование, а
 * параллельный залп на десятках файлов упирается в лимиты и начинает
 * отдавать 429 — последовательная очередь медленнее, но доходит.
 */
async function copyFiles(files: CopyFile[], onProgress?: (p: CopyProgress) => void): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress?.({ copied: i, total: files.length })
    const { error } = await supabase.storage.from(file.bucket).copy(file.from, file.to)
    if (error) {
      throw new Error(`Не удалось скопировать файл «${file.from.replace(/^.*\//, '')}»: ${error.message}`)
    }
  }
  onProgress?.({ copied: files.length, total: files.length })
}

/**
 * Общий хвост обеих операций: скопировать файлы и закрыть задание, а при
 * любом сбое — откатить созданное и вернуть понятную ошибку.
 */
async function finishCopy(plan: CopyPlan, onProgress?: (p: CopyProgress) => void): Promise<CopyPlan> {
  try {
    await copyFiles(plan.files, onProgress)
  } catch (err) {
    // Откат делаем best-effort: если и он не прошёл, показываем исходную
    // причину — она полезнее, чем «не удалось откатить».
    try { await supabase.rpc('course_copy_rollback', { p_job_id: plan.jobId }) } catch { /* см. выше */ }
    throw err
  }

  const { error } = await supabase.rpc('course_copy_finalize', { p_job_id: plan.jobId })
  if (error) throw new Error('Копия создана, но задание не закрылось: ' + error.message)
  return plan
}

export interface CopyCourseParams {
  sourceCourseId: string
  title?: string | null
  mode: CopyDateMode
  shiftDays?: number
  onProgress?: (p: CopyProgress) => void
}

/** Копия курса целиком. Возвращает id новой копии. */
export async function copyCourse(params: CopyCourseParams): Promise<CopyPlan> {
  const { data, error } = await supabase.rpc('course_copy_stage', {
    p_source_course_id: params.sourceCourseId,
    p_title: params.title?.trim() || null,
    p_mode: params.mode,
    p_shift_days: params.shiftDays ?? 0,
  } as never)
  if (error) throw new Error(error.message)

  const plan = toPlan(data)
  return finishCopy(plan, params.onProgress)
}

export interface CopyTopicParams {
  sourceTopicId: string
  targetModuleId: string
  mode: CopyDateMode
  shiftDays?: number
  onProgress?: (p: CopyProgress) => void
}

/** Копия одной темы в модуль другого курса. Оригинал остаётся на месте. */
export async function copyTopic(params: CopyTopicParams): Promise<CopyPlan> {
  const { data, error } = await supabase.rpc('topic_copy_stage', {
    p_source_topic_id: params.sourceTopicId,
    p_target_module_id: params.targetModuleId,
    p_mode: params.mode,
    p_shift_days: params.shiftDays ?? 0,
  } as never)
  if (error) throw new Error(error.message)

  const plan = toPlan(data)
  return finishCopy(plan, params.onProgress)
}

/**
 * Ответ RPC приходит как jsonb. Разбираем его отдельно и защищённо: если
 * форма вдруг окажется другой, лучше упасть здесь с внятным текстом, чем
 * позже на `undefined.length` посреди копирования файлов.
 */
export function toPlan(data: unknown): CopyPlan {
  const raw = data as { job_id?: string; course_id?: string; topic_id?: string; files?: unknown } | null
  if (!raw?.job_id) throw new Error('База не вернула задание копирования')
  return {
    jobId: raw.job_id,
    courseId: raw.course_id,
    topicId: raw.topic_id,
    files: Array.isArray(raw.files) ? (raw.files as CopyFile[]) : [],
  }
}
