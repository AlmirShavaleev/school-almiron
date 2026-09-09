/**
 * Чистые помощники вкладки «Видео» (статистика просмотра из Bunny Stream).
 *
 * Здесь нет обращений к сети — только пересчёт и формат. Числа приходят
 * готовыми из edge-функции `bunny-video-stats`; всё, что ниже, отвечает на
 * вопрос «как это показать, не соврав».
 *
 * ЕДИНИЦЫ. Bunny отдаёт `length`, `totalWatchTime`, `averageWatchTime` в
 * СЕКУНДАХ. Это проверено разведкой на живых ответах, а не взято из
 * документации: у 181 ролика библиотеки `averageWatchTime` ни разу не
 * превышает `length`, среднее время на один просмотр выходит 7,7 минуты, а
 * сумма по всем роликам совпала с суммой графика за период. Перепутанная
 * единица здесь превращает минуты в бессмыслицу молча, поэтому проверка была.
 */

/** Один урок в таблице. Строка = ВИДЕО, а не запись материала (см. ниже). */
export interface VideoLesson {
  videoId:        string
  /** Название темы курса. У копий одного ролика оно совпадает. */
  topicTitle:     string
  /** Название в библиотеке Bunny — бывает другим, показываем подсказкой. */
  bunnyTitle:     string
  /** Живые курсы, где стоит ролик. Шаблоны сюда не попадают. */
  courses:        string[]
  /** Сколько записей материалов ссылается на этот ролик (2–3 у нас). */
  placements:     number
  /** Ролик стоит только в шаблоне — учиться по нему некому. */
  onlyInTemplate: boolean
  /** Ролика нет в библиотеке. Это НЕ «ноль просмотров». */
  missingInBunny: boolean
  views:          number
  lengthSec:      number
  totalWatchSec:  number
  avgWatchSec:    number
}

export type LessonSort = 'views' | 'minutes'

/**
 * Минуты из секунд для показа. Округление до целых: доли минуты в отчёте о
 * том, «сколько смотрели», не значат ничего.
 */
export function toMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds / 60)
}

/** «12:05» — длительность ролика и отметка на тепловой карте. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Доля досмотра: сколько ролика в среднем успевают посмотреть.
 *
 * Это единственное ЧЕСТНОЕ абсолютное число про удержание, которое у нас
 * есть. Тепловая карта Bunny нормирована (100 = самая смотримая секунда) и
 * отвечает на вопрос «где внимание», а не «сколько досмотрели».
 *
 * `null`, когда считать не из чего: без длины ролика доля не определена, а
 * ноль читался бы как «не смотрят вовсе».
 */
export function watchedShare(avgWatchSec: number, lengthSec: number): number | null {
  if (!Number.isFinite(avgWatchSec) || !Number.isFinite(lengthSec) || lengthSec <= 0) return null
  if (avgWatchSec <= 0) return 0
  return Math.min(avgWatchSec / lengthSec, 1)
}

/** Уроки, у которых просмотров нет вовсе. Ролики, пропавшие из Bunny, сюда НЕ идут. */
export function neverWatched(lessons: VideoLesson[]): VideoLesson[] {
  return lessons.filter(l => !l.missingInBunny && l.views === 0)
}

/** Уроки, которые смотрели хоть раз, — в порядке выбранной сортировки. */
export function watchedLessons(lessons: VideoLesson[], sort: LessonSort): VideoLesson[] {
  const seen = lessons.filter(l => !l.missingInBunny && l.views > 0)
  return [...seen].sort((a, b) => {
    const diff = sort === 'views'
      ? b.views - a.views
      : b.totalWatchSec - a.totalWatchSec
    return diff || a.topicTitle.localeCompare(b.topicTitle, 'ru')
  })
}

/** Уроки, чьи ролики исчезли из библиотеки. Отдельно от «не смотрели». */
export function missingLessons(lessons: VideoLesson[]): VideoLesson[] {
  return lessons.filter(l => l.missingInBunny)
}

export interface HeatmapPoint {
  /** Номер отрезка, от нуля. */
  index: number
  /** Секунда начала отрезка — по ней подписываются деления. */
  atSec: number
  /** Относительное внимание, 0..100. 100 — самый смотримый отрезок ролика. */
  value: number
}

/**
 * Тепловая карта Bunny → ряд точек для графика.
 *
 * Три вещи, каждая найдена разведкой на живом ответе и каждая молча врёт,
 * если её не сделать:
 *
 * 1. **Дырки.** У ролика на 1159 с пришло 205 ключей на диапазон 0…231 —
 *    28 отрезков отсутствуют. Пропуск означает НОЛЬ внимания; если их не
 *    заполнить, график соединит соседей линией и покажет ровное внимание там,
 *    где его не было вовсе.
 * 2. **Ключ `-1`.** Недокументированный, и он не ноль (у нашего ролика 14).
 *    Что это за отрезок — Bunny не объясняет, на шкалу времени его положить
 *    некуда. Выбрасываем: рисовать его перед началом ролика значило бы
 *    придумать смысл, которого мы не знаем.
 * 3. **Длина отрезка не документирована.** Считается делением: последний
 *    ключ 231 при ролике 1159 с даёт 232 отрезка по ≈5 с. Без длины ролика
 *    подписи времени не строим вовсе — номера отрезков человеку не говорят
 *    ничего.
 */
export function heatmapSeries(
  heatmap: Record<string, unknown> | null | undefined,
  lengthSec: number,
): HeatmapPoint[] {
  if (!heatmap || typeof heatmap !== 'object') return []

  const indices = Object.keys(heatmap)
    .map(key => Number(key))
    .filter(n => Number.isInteger(n) && n >= 0)
  if (indices.length === 0) return []

  const last = Math.max(...indices)
  const segments = last + 1
  const perSegment = Number.isFinite(lengthSec) && lengthSec > 0 ? lengthSec / segments : 0

  const points: HeatmapPoint[] = []
  for (let index = 0; index <= last; index++) {
    const raw = (heatmap as Record<string, unknown>)[String(index)]
    const value = Number(raw ?? 0)
    points.push({
      index,
      atSec: perSegment * index,
      // Пропуск = ноль внимания, а не «нет данных».
      value: Number.isFinite(value) ? value : 0,
    })
  }
  return points
}

/**
 * Где внимание падает вдвое от пика — то самое «на какой минуте бросают».
 *
 * Два решения, и оба выяснились на тесте, а не в замысле:
 *
 * 1. **Порог от ПИКА, а не от первой точки.** Пик почти всегда в начале
 *    (ролик открывают все), но у карты с разгоном первая точка бывает ниже
 *    второй, и отсчёт от неё дал бы случайный ответ.
 * 2. **Искать только ПОСЛЕ пика.** Иначе на той же карте с разгоном (40, 100,
 *    60, 30) ответом становится нулевой отрезок со значением 40: он ниже
 *    половины пика, но это ещё не падение, а подъём к нему. Спад — это то,
 *    что случилось после максимума.
 *
 * `null`, если внимание так и не упало вдвое, — тогда честнее не показывать
 * отметку, чем выдумать её на последней секунде.
 */
export function attentionHalvesAt(points: HeatmapPoint[]): HeatmapPoint | null {
  if (points.length === 0) return null

  let peak = -1
  let peakAt = 0
  for (const point of points) {
    if (point.value > peak) {
      peak = point.value
      peakAt = point.index
    }
  }
  if (peak <= 0) return null

  const half = peak / 2
  return points.find(p => p.index > peakAt && p.value < half) ?? null
}
