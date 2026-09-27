/**
 * Тренировка в темах курса (§234): задачник владельца по кодификатору.
 *
 * Строки лежат в той же таблице `topic_material_items`, но на своей дорожке —
 * `track = 'training'`, с номером и названием подтемы. Материалы темы, какими
 * они были до §234 (банк ФИПИ), — дорожка `ege`, у ученика это «Формат ЕГЭ».
 *
 * Решения владельца, из которых следует устройство:
 *  - тренировка НЕ входит в «тема пройдена» — поэтому все прежние запросы
 *    материалов фильтруют `track = 'ege'` (`EGE_TRACK`), а тренировку читает
 *    только свой хук `useTopicTraining`;
 *  - тренировочное ДЗ — самопроверка по решениям, в `topic_homework*` не
 *    пишется и в очередь проверки не попадает;
 *  - решения видны сразу (база: гейт §95 тренировку не касается);
 *  - учитель скрывает подтему для своего класса — `topic_subtopic_hidden`,
 *    не `is_visible`: синхронизация каркаса затёрла бы классное скрытие.
 */

/** Дорожка материалов темы курса — всё, что было до §234. */
export const EGE_TRACK = 'ege'
export const TRAINING_TRACK = 'training'

/** Рубрики тренировки. `homework_tasks` есть только здесь (CHECK в базе). */
export type TrainingSection =
  | 'theory' | 'tasks' | 'worksheet_tasks' | 'task_solution'
  | 'homework_tasks' | 'worksheet_homework' | 'solution'

/** Где подтема проходится: на уроке или дома. */
export type TrainingPlace = 'lesson' | 'home'

export interface TrainingRole {
  /** Номер роли = префикс файла задачника = `position` строки. */
  position: number
  section: TrainingSection
  /** Короткая подпись на кнопке файла у ученика. */
  label: string
  place: TrainingPlace
}

/**
 * Семь файлов подтемы. Порядок и префиксы — как у владельца в папках
 * задачника (`0. Теория (1.17).pdf` … `6. ДЗ - решения (1.17).pdf`); та же
 * таблица лежит в загрузчике `scripts/trenirovka-plan.mjs` — копия, а не
 * импорт, по той же причине, что транслитерация в import-lessons.
 */
export const TRAINING_ROLES: readonly TrainingRole[] = [
  { position: 0, section: 'theory',             label: 'Теория',            place: 'lesson' },
  { position: 1, section: 'tasks',              label: 'Список задач',      place: 'lesson' },
  { position: 2, section: 'worksheet_tasks',    label: 'Рабочий лист',      place: 'lesson' },
  { position: 3, section: 'task_solution',      label: 'Решения',           place: 'lesson' },
  { position: 4, section: 'homework_tasks',     label: 'ДЗ · список задач', place: 'home' },
  { position: 5, section: 'worksheet_homework', label: 'ДЗ · рабочий лист', place: 'home' },
  { position: 6, section: 'solution',           label: 'ДЗ · решения',      place: 'home' },
] as const

export const TRAINING_PLACE_LABELS: Record<TrainingPlace, string> = {
  lesson: 'На уроке',
  home: 'Дома',
}

/** Пояснение над подтемами — слово в слово из задачи владельца. */
export const TRAINING_NOTE = 'Задачи на отработку приёмов. Не в формате ЕГЭ, в прогноз балла не идут'

function roleOf(section: string | null | undefined): TrainingRole | undefined {
  return TRAINING_ROLES.find(r => r.section === section)
}

/**
 * Порядок подтем: по частям номера как по числам — 1.14 < 1.17 < 1.18,
 * 1.4.1 < 1.4.2 < 1.5 < 1.10, 2.15 < 2.15.1. Строковое сравнение ставило бы
 * 1.10 раньше 1.2 — ученик читал бы задачник вразнобой.
 */
export function compareSubtopicCodes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (i >= pa.length) return -1
    if (i >= pb.length) return 1
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb
    } else {
      const c = pa[i].localeCompare(pb[i], 'ru')
      if (c !== 0) return c
    }
  }
  return 0
}

/** Строка тренировки в объёме, который читает `useTopicTraining`. */
export interface TrainingItemRow {
  id: string
  topic_id: string
  kind: string
  title: string | null
  storage_path: string | null
  file_name: string | null
  size_bytes: number | null
  position: number
  is_visible: boolean
  section: string | null
  subtopic_code: string | null
  subtopic_title: string | null
}

export interface TrainingItem {
  id: string
  section: TrainingSection
  /** Подпись роли («Список задач»), а не заголовок строки: номер подтемы
   *  уже стоит рядом, повторять его на каждой кнопке — шум. */
  label: string
  place: TrainingPlace
  storagePath: string
  fileName: string | null
  sizeBytes: number | null
  isVisible: boolean
}

export interface TrainingSubtopic {
  code: string
  title: string
  lesson: TrainingItem[]
  home: TrainingItem[]
  /** Сколько файлов у подтемы (обе строки вместе). */
  total: number
  /** Скрыта учителем для этого класса. */
  hidden: boolean
}

/**
 * Подпись кнопки — из заголовка строки «Подпись · код», если он такой.
 * Загрузчик пишет подпись из раскладки: у физики «Список задач», у математики
 * (§234.1) — «Задачи». Иначе подпись роли по рубрике.
 */
function labelFromTitle(title: string | null, code: string): string | null {
  const t = title?.trim()
  const suffix = ` · ${code}`
  if (!t || !t.endsWith(suffix)) return null
  const label = t.slice(0, -suffix.length).trim()
  return label || null
}

/**
 * Строки тренировки → подтемы в порядке кодификатора, внутри — в порядке
 * ролей. Строки без файла или с незнакомой рубрикой пропускаются: показать
 * их нечем, а упасть из-за одной кривой строки хуже.
 */
export function buildTrainingSubtopics(
  rows: readonly TrainingItemRow[],
  hiddenCodes: Iterable<string> = [],
): TrainingSubtopic[] {
  const hidden = new Set(hiddenCodes)
  const byCode = new Map<string, { title: string; items: (TrainingItem & { order: number })[] }>()

  for (const row of rows) {
    const code = row.subtopic_code?.trim()
    const role = roleOf(row.section)
    if (!code || !role || !row.storage_path) continue
    const entry = byCode.get(code) ?? { title: '', items: [] }
    if (!entry.title && row.subtopic_title?.trim()) entry.title = row.subtopic_title.trim()
    entry.items.push({
      id: row.id,
      section: role.section,
      label: labelFromTitle(row.title, code) ?? role.label,
      place: role.place,
      storagePath: row.storage_path,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      isVisible: row.is_visible,
      order: role.position * 1000 + row.position,
    })
    byCode.set(code, entry)
  }

  return [...byCode.entries()]
    .sort(([a], [b]) => compareSubtopicCodes(a, b))
    .map(([code, { title, items }]) => {
      const sorted: TrainingItem[] = [...items]
        .sort((x, y) => x.order - y.order)
        .map(i => ({
          id: i.id, section: i.section, label: i.label, place: i.place,
          storagePath: i.storagePath, fileName: i.fileName, sizeBytes: i.sizeBytes, isVisible: i.isVisible,
        }))
      return {
        code,
        title,
        lesson: sorted.filter(i => i.place === 'lesson'),
        home: sorted.filter(i => i.place === 'home'),
        total: sorted.length,
        hidden: hidden.has(code),
      }
    })
}

/**
 * Что показывать ученику: без скрытых учителем подтем и без скрытых файлов.
 * Базу это не заменяет — ученику скрытое не приходит и так (политика на
 * строку); фильтр нужен предпросмотру персонала, которому RLS отдаёт всё.
 */
export function subtopicsForStudent(subtopics: readonly TrainingSubtopic[]): TrainingSubtopic[] {
  return subtopics
    .filter(s => !s.hidden)
    .map(s => {
      const lesson = s.lesson.filter(i => i.isVisible)
      const home = s.home.filter(i => i.isVisible)
      return { ...s, lesson, home, total: lesson.length + home.length }
    })
    .filter(s => s.total > 0)
}

/**
 * «Только материалы темы» для запроса к `topic_material_items`: фильтр
 * `track = 'ege'`. Все прежние места чтения материалов идут через него.
 *
 * Функция, а не `.eq('track', …)` по месту: столбца нет в сгенерированных
 * типах базы (их перегенерирует оркестратор после PENDING_234, руками не
 * дописываем), и приведение типа должно жить в одном месте, а не в шести.
 */
export function onlyEgeTrack<Q>(query: Q): Q {
  return (query as unknown as { eq(column: string, value: string): Q }).eq('track', EGE_TRACK)
}
