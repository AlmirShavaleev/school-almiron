/**
 * trenirovka-plan.mjs — чистая часть загрузчика задачника (§234).
 *
 * Без сети и без диска: разбор имени файла, порядок подтем, план загрузки по
 * раскладке и сверка с тем, что уже лежит в базе. Всё решающее проверяется
 * тестами (`src/lib/__tests__/trenirovkaPlan.test.ts`), а не глазами по логу:
 * ошибка здесь — 1 449 файлов не в тех рубриках у трёх классов разом.
 *
 * Таблица ролей — копия `TRAINING_ROLES` из `src/lib/training.ts` (скрипт на
 * .mjs, исходник на TypeScript — та же причина, что у транслитерации в
 * import-lessons). Разъедутся — тест `trenirovkaPlan.test.ts` это поймает.
 */

/** Роль файла по префиксу: `0. Теория (1.17).pdf` → theory. */
export const TRAINING_ROLES = [
  { position: 0, section: 'theory',             label: 'Теория' },
  { position: 1, section: 'tasks',              label: 'Список задач' },
  { position: 2, section: 'worksheet_tasks',    label: 'Рабочий лист' },
  { position: 3, section: 'task_solution',      label: 'Решения' },
  { position: 4, section: 'homework_tasks',     label: 'ДЗ · список задач' },
  { position: 5, section: 'worksheet_homework', label: 'ДЗ · рабочий лист' },
  { position: 6, section: 'solution',           label: 'ДЗ · решения' },
]

const FILE_RE = /^([0-9])\.\s*(.+?)\s*\(\s*(\d+(?:\.\d+)*)\s*\)\.pdf$/i

/**
 * `4. ДЗ - список задач (1.17).pdf` → { position: 4, section: 'homework_tasks',
 * label: 'ДЗ · список задач', code: '1.17' }. Не по шаблону или префикс вне
 * 0–6 — null: такой файл в загрузку не идёт, а попадает в список проблем.
 *
 * Роль решает ТОЛЬКО префикс — так велел владелец. Название после точки
 * (`Список задач`, `ДЗ - список задач`) у него бывает с опечатками, и ставить
 * рубрику по словам значило бы молча класть файл не туда.
 */
export function parseTrainingFileName(name) {
  const m = String(name ?? '').trim().match(FILE_RE)
  if (!m) return null
  const role = TRAINING_ROLES.find(r => r.position === Number(m[1]))
  if (!role) return null
  return { position: role.position, section: role.section, label: role.label, code: m[3], rawLabel: m[2] }
}

/** Порядок подтем по частям номера как по числам: 1.4.2 < 1.5 < 1.10 < 1.14. */
export function compareSubtopicCodes(a, b) {
  const pa = String(a).split('.')
  const pb = String(b).split('.')
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

/** «Теория · 1.17», «ДЗ · список задач · 1.17». */
export function materialTitle(label, code) {
  return `${label} · ${code}`
}

/** `--only 1.17,2.15.1` → ['1.17', '2.15.1']; пусто — null (все подтемы). */
export function parseOnly(value) {
  if (value == null || value === true) return null
  const list = String(value).split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  return list.length ? list : null
}

/**
 * План загрузки по раскладке владельца.
 *
 * Возвращает подтемы в порядке кодификатора; у каждой — семь файлов с
 * рубрикой, позицией (= номер роли) и заголовком. Всё подозрительное — в
 * `problems`, и такие подтемы в план НЕ входят: лучше догрузить одну подтему
 * вторым заходом, чем разложить её криво.
 */
export function buildPlan(mapping, { only = null } = {}) {
  // §234.1: «явная» раскладка (задачник по математике) — роль файла задана в
  // самой раскладке, а не префиксом имени. Физика (формат по умолчанию) идёт
  // прежней веткой без единого изменения.
  const explicit = mapping?.format === 'explicit'
  // §236: «явная» раскладка может класть файлы и на дорожку курса (`ege`) —
  // обычные материалы темы (методички «Оформление»). По умолчанию — тренировка.
  const track = explicit && mapping?.track === 'ege' ? 'ege' : 'training'
  const problems = []
  if (mapping?.track != null && !explicit) problems.push('поле track допустимо только в «явной» раскладке')
  if (explicit && mapping?.track != null && !['ege', 'training'].includes(mapping.track)) {
    problems.push(`track «${mapping.track}» — допустимо ege или training`)
  }
  const subtopics = []
  const seen = new Set()
  const wanted = only ? new Set(only) : null

  for (const s of mapping?.subtopics ?? []) {
    const code = String(s.code ?? '').trim()
    if (wanted && !wanted.has(code)) continue
    const where = `${code || '?'} ${s.title ?? ''}`.trim()

    if (!code) { problems.push(`${where}: нет номера подтемы`); continue }
    if (seen.has(code)) { problems.push(`${where}: номер встречается в раскладке дважды`); continue }
    seen.add(code)
    if (!s.template_topic_id) { problems.push(`${where}: не указана тема шаблона`); continue }
    if (!s.folder) { problems.push(`${where}: не указана папка`); continue }

    const files = []
    const bad = []
    if (explicit) {
      collectExplicitFiles(s, code, files, bad, track)
    } else for (const fileName of s.files ?? []) {
      const parsed = parseTrainingFileName(fileName)
      if (!parsed) { bad.push(`«${fileName}» — имя не по шаблону «N. Название (${code}).pdf»`); continue }
      if (parsed.code !== code) { bad.push(`«${fileName}» — номер в имени ${parsed.code}, а подтема ${code}`); continue }
      if (files.some(f => f.position === parsed.position)) { bad.push(`«${fileName}» — второй файл с префиксом ${parsed.position}.`); continue }
      files.push({
        fileName,
        relPath: `${s.folder}/${fileName}`,
        section: parsed.section,
        position: parsed.position,
        title: materialTitle(parsed.label, code),
      })
    }
    if (!explicit) {
      const missing = TRAINING_ROLES.filter(r => !files.some(f => f.position === r.position))
      for (const r of missing) bad.push(`нет файла «${r.position}. …» (${r.label})`)
    }

    if (bad.length) {
      problems.push(`${where}: ${bad.join('; ')}`)
      continue
    }
    files.sort((a, b) => a.position - b.position)
    subtopics.push({
      code,
      title: String(s.title ?? '').trim(),
      topicId: s.template_topic_id,
      topicTitle: s.topic_title ?? '',
      folder: s.folder,
      track,
      files,
    })
  }

  if (wanted) {
    for (const code of wanted) if (!seen.has(code)) problems.push(`${code}: такой подтемы в раскладке нет`)
  }

  subtopics.sort((a, b) => compareSubtopicCodes(a.code, b.code))
  return { subtopics, problems }
}

const TRAINING_SECTIONS = TRAINING_ROLES.map(r => r.section)

/**
 * Файлы подтемы «явной» раскладки: `{ name, section, label }`.
 *
 * Проверки «ровно семь ролей 0–6» и «номер в имени = код» здесь не действуют:
 * у математики в подтеме один файл (`00_Теория.pdf` или `02_Площадь_треугольника.pdf`),
 * и номера в имени нет. Остаётся то, без чего файл некуда положить: имя, рубрика
 * из списка тренировки и не больше одного файла на рубрику (ключ
 * идемпотентности — тема + код + рубрика, второй файл той же рубрики загрузчик
 * посчитал бы уже загруженным). `position` — порядок файла в подтеме.
 */
function collectExplicitFiles(s, code, files, bad, track = 'training') {
  const list = Array.isArray(s.files) ? s.files : []
  if (list.length === 0) bad.push('нет ни одного файла')
  list.forEach((f, i) => {
    const name = typeof f?.name === 'string' ? f.name.trim() : ''
    const section = typeof f?.section === 'string' ? f.section.trim() : ''
    if (!name) { bad.push(`файл №${i + 1} — не указано имя`); return }
    if (!section) { bad.push(`«${name}» — не указана рубрика`); return }
    if (track === 'ege' && section === 'homework_tasks') { bad.push(`«${name}» — рубрика homework_tasks есть только у тренировки`); return }
    if (!TRAINING_SECTIONS.includes(section)) {
      bad.push(`«${name}» — рубрика «${section}» не из списка тренировки (${TRAINING_SECTIONS.join(', ')})`)
      return
    }
    if (files.some(x => x.section === section)) { bad.push(`«${name}» — второй файл рубрики ${section}`); return }
    const label = (typeof f.label === 'string' && f.label.trim()) || TRAINING_ROLES.find(r => r.section === section).label
    files.push({
      fileName: name,
      relPath: `${s.folder}/${name}`,
      section,
      position: files.length,
      // У материалов курса (§236) заголовок — само название, без кода подтемы.
      title: track === 'ege' ? label : materialTitle(label, code),
    })
  })
}

/**
 * Что из подтемы ещё не загружено. Ключ идемпотентности — тема + номер
 * подтемы + рубрика: повторный запуск после обрыва догружает только
 * недостающее и не задваивает уже лежащее.
 */
export function missingFiles(subtopic, existingRows) {
  const have = new Set(
    (existingRows ?? [])
      .filter(r => r.topic_id === subtopic.topicId && r.subtopic_code === subtopic.code)
      .map(r => r.section),
  )
  return subtopic.files.filter(f => !have.has(f.section))
}

/** Строки для вставки: одна подтема — один запрос (решение задачи §234). */
export function insertRows(subtopic, uploaded, createdBy) {
  return uploaded.map(({ file, storagePath, size }) => ({
    topic_id: subtopic.topicId,
    kind: 'file',
    track: subtopic.track ?? 'training',
    subtopic_code: subtopic.code,
    subtopic_title: subtopic.title,
    section: file.section,
    position: file.position,
    title: file.title,
    storage_path: storagePath,
    file_name: file.fileName,
    mime_type: 'application/pdf',
    size_bytes: size,
    is_visible: true,
    created_by: createdBy,
  }))
}

/** Сводка плана: сколько подтем, файлов и тем шаблона. */
export function summarizePlan(subtopics) {
  const topics = new Set(subtopics.map(s => s.topicId))
  return {
    subtopics: subtopics.length,
    files: subtopics.reduce((n, s) => n + s.files.length, 0),
    topics: topics.size,
  }
}
