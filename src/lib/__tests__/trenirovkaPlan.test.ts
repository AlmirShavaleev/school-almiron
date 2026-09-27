import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildPlan, compareSubtopicCodes, insertRows, materialTitle, missingFiles, parseOnly, parseTrainingFileName,
  summarizePlan, TRAINING_ROLES as SCRIPT_ROLES,
// @ts-expect-error — скрипт на .mjs без типов, тестируем его чистые функции
} from '../../../scripts/trenirovka-plan.mjs'
import { TRAINING_ROLES, compareSubtopicCodes as uiCompare } from '@/lib/training'

/**
 * Загрузчик задачника (§234) раскладывает 1 449 файлов в темы трёх классов
 * разом. Решающие функции проверяются здесь: какой файл в какую рубрику,
 * в каком порядке подтемы и что считается «уже загружено».
 */

// Раскладка владельца — та самая копия, что читает загрузчик.
const mapping = JSON.parse(readFileSync(join(process.cwd(), 'scripts/trenirovka-mapping.json'), 'utf8'))

const T = '7d52a556-371a-4e8e-ac74-cf06e9dc63d5'
const files = (code: string) => [
  `0. Теория (${code}).pdf`, `1. Список задач (${code}).pdf`, `2. Рабочий лист (${code}).pdf`,
  `3. Решения (${code}).pdf`, `4. ДЗ - список задач (${code}).pdf`, `5. ДЗ - рабочий лист (${code}).pdf`,
  `6. ДЗ - решения (${code}).pdf`,
]
const sub = (code: string, extra: Record<string, unknown> = {}) => ({
  code, title: `Подтема ${code}`, folder: `01 Кинематика/${code} Подтема`, template_topic_id: T,
  topic_title: 'Кинематика', files: files(code), ...extra,
})

describe('parseTrainingFileName — роль по префиксу', () => {
  it.each([
    ['0. Теория (1.17).pdf', 'theory', 0],
    ['1. Список задач (1.17).pdf', 'tasks', 1],
    ['2. Рабочий лист (1.17).pdf', 'worksheet_tasks', 2],
    ['3. Решения (1.17).pdf', 'task_solution', 3],
    ['4. ДЗ - список задач (1.17).pdf', 'homework_tasks', 4],
    ['5. ДЗ - рабочий лист (1.17).pdf', 'worksheet_homework', 5],
    ['6. ДЗ - решения (1.17).pdf', 'solution', 6],
  ])('%s → %s', (name, section, position) => {
    expect(parseTrainingFileName(name)).toMatchObject({ section, position, code: '1.17' })
  })

  it('роль решает префикс, а не слова: опечатка в названии рубрику не меняет', () => {
    expect(parseTrainingFileName('4. Решения (2.15.1).PDF')).toMatchObject({ section: 'homework_tasks', code: '2.15.1' })
  })

  it.each(['7. Лишнее (1.17).pdf', 'Теория (1.17).pdf', '0. Теория 1.17.pdf', '0. Теория (1.17).docx', ''])(
    'не по шаблону — null: «%s»', (name) => {
      expect(parseTrainingFileName(name)).toBeNull()
    })
})

describe('compareSubtopicCodes — порядок кодификатора', () => {
  it('части сравниваются как числа', () => {
    const codes = ['1.18', '1.10', '1.4.2', '1.14', '2.15', '1.2', '1.4.1', '10.1', '2.15.1', '1.17']
    expect([...codes].sort(compareSubtopicCodes))
      .toEqual(['1.2', '1.4.1', '1.4.2', '1.10', '1.14', '1.17', '1.18', '2.15', '2.15.1', '10.1'])
  })

  it('клиент сортирует так же, как загрузчик', () => {
    const codes = mapping.subtopics.map((s: { code: string }) => s.code).reverse()
    expect([...codes].sort(uiCompare)).toEqual([...codes].sort(compareSubtopicCodes))
  })
})

describe('роли загрузчика и интерфейса — одна таблица', () => {
  it('позиция, рубрика и подпись совпадают', () => {
    expect(SCRIPT_ROLES.map((r: { position: number; section: string; label: string }) => [r.position, r.section, r.label]))
      .toEqual(TRAINING_ROLES.map(r => [r.position, r.section, r.label]))
  })
})

describe('buildPlan — план по раскладке', () => {
  it('раскладка владельца: 207 подтем, 1 449 файлов, 39 тем, без проблем', () => {
    const { subtopics, problems } = buildPlan(mapping)
    expect(problems).toEqual([])
    expect(summarizePlan(subtopics)).toEqual({ subtopics: 207, files: 1449, topics: 39 })
    // Порядок — кодификатора, а не файла раскладки.
    const codes = subtopics.map((s: { code: string }) => s.code)
    expect(codes).toEqual([...codes].sort(compareSubtopicCodes))
  })

  it('у подтемы семь файлов с рубрикой, позицией = номер роли и заголовком «Роль · код»', () => {
    const { subtopics } = buildPlan({ subtopics: [sub('1.17')] })
    expect(subtopics[0].files.map((f: { section: string; position: number; title: string }) => [f.position, f.section, f.title])).toEqual([
      [0, 'theory', 'Теория · 1.17'],
      [1, 'tasks', 'Список задач · 1.17'],
      [2, 'worksheet_tasks', 'Рабочий лист · 1.17'],
      [3, 'task_solution', 'Решения · 1.17'],
      [4, 'homework_tasks', 'ДЗ · список задач · 1.17'],
      [5, 'worksheet_homework', 'ДЗ · рабочий лист · 1.17'],
      [6, 'solution', 'ДЗ · решения · 1.17'],
    ])
    expect(subtopics[0].files[0].relPath).toBe('01 Кинематика/1.17 Подтема/0. Теория (1.17).pdf')
  })

  it('--only оставляет названные подтемы и жалуется на несуществующие', () => {
    const { subtopics, problems } = buildPlan({ subtopics: [sub('1.14'), sub('1.17')] }, { only: ['1.17', '9.99'] })
    expect(subtopics.map((s: { code: string }) => s.code)).toEqual(['1.17'])
    expect(problems).toEqual(['9.99: такой подтемы в раскладке нет'])
  })

  it('подтема с недостающим, чужим или задвоенным файлом в план не входит', () => {
    const noHomework = sub('1.1', { files: files('1.1').filter(f => !f.startsWith('4.')) })
    const foreign = sub('1.2', { files: [...files('1.2').slice(0, 6), '6. ДЗ - решения (1.3).pdf'] })
    const twice = sub('1.5', { files: [...files('1.5'), '0. Теория-2 (1.5).pdf'] })
    const noTopic = sub('1.6', { template_topic_id: null })
    const { subtopics, problems } = buildPlan({ subtopics: [noHomework, foreign, twice, noTopic, sub('1.7')] })
    expect(subtopics.map((s: { code: string }) => s.code)).toEqual(['1.7'])
    expect(problems).toHaveLength(4)
    expect(problems[0]).toMatch(/^1\.1 .*нет файла «4\. …» \(ДЗ · список задач\)/)
    expect(problems[1]).toMatch(/номер в имени 1\.3, а подтема 1\.2/)
    expect(problems[2]).toMatch(/второй файл с префиксом 0/)
    expect(problems[3]).toMatch(/не указана тема шаблона/)
  })

  it('номер, встреченный дважды, — проблема, а не две загрузки', () => {
    const { subtopics, problems } = buildPlan({ subtopics: [sub('1.17'), sub('1.17')] })
    expect(subtopics).toHaveLength(1)
    expect(problems).toEqual([expect.stringMatching(/дважды/)])
  })
})

describe('missingFiles — идемпотентность по теме + подтеме + рубрике', () => {
  const plan = buildPlan({ subtopics: [sub('1.17')] }).subtopics[0]

  it('ничего не загружено — все семь', () => {
    expect(missingFiles(plan, [])).toHaveLength(7)
  })

  it('обрыв посередине: догружается только недостающее', () => {
    const existing = [
      { topic_id: T, subtopic_code: '1.17', section: 'theory' },
      { topic_id: T, subtopic_code: '1.17', section: 'tasks' },
      // Та же рубрика у другой подтемы и в другой теме — не считается.
      { topic_id: T, subtopic_code: '1.18', section: 'worksheet_tasks' },
      { topic_id: 'другая', subtopic_code: '1.17', section: 'solution' },
    ]
    expect(missingFiles(plan, existing).map((f: { section: string }) => f.section))
      .toEqual(['worksheet_tasks', 'task_solution', 'homework_tasks', 'worksheet_homework', 'solution'])
  })

  it('всё на месте — пусто', () => {
    const existing = plan.files.map((f: { section: string }) => ({ topic_id: T, subtopic_code: '1.17', section: f.section }))
    expect(missingFiles(plan, existing)).toEqual([])
  })
})

describe('insertRows — строки шаблона', () => {
  it('дорожка training, подтема, рубрика, позиция и путь', () => {
    const plan = buildPlan({ subtopics: [sub('1.17')] }).subtopics[0]
    const rows = insertRows(plan, [{ file: plan.files[4], storagePath: `${T}/1_dz.pdf`, size: 123 }], 'owner')
    expect(rows).toEqual([{
      topic_id: T, kind: 'file', track: 'training', subtopic_code: '1.17', subtopic_title: 'Подтема 1.17',
      section: 'homework_tasks', position: 4, title: 'ДЗ · список задач · 1.17',
      storage_path: `${T}/1_dz.pdf`, file_name: '4. ДЗ - список задач (1.17).pdf', mime_type: 'application/pdf',
      size_bytes: 123, is_visible: true, created_by: 'owner',
    }])
  })
})

describe('parseOnly', () => {
  it.each([
    [undefined, null], ['', null], ['1.17', ['1.17']], ['1.17,2.15.1', ['1.17', '2.15.1']], ['1.17 1.18', ['1.17', '1.18']],
  ])('%s → %j', (value, expected) => {
    expect(parseOnly(value)).toEqual(expected)
  })
  it('materialTitle', () => {
    expect(materialTitle('Теория', '1.4.1')).toBe('Теория · 1.4.1')
  })
})

// ── §234.1: «явная» раскладка (задачник по математике) ──────────────────────

const mathMapping = JSON.parse(readFileSync(join(process.cwd(), 'scripts/trenirovka-math-mapping.json'), 'utf8'))
const M = '18ec6504-4ca0-4421-8b21-9e16deb08885'
const explicit = (subtopics: unknown[]) => ({ format: 'explicit', template_course_id: 'fbf65ad2', subtopics })
const msub = (code: string, files: unknown[], extra: Record<string, unknown> = {}) => ({
  code, title: `Подтема ${code}`, folder: 'ЕГЭ математика/Задание 01. Планиметрия', template_topic_id: M, files, ...extra,
})

describe('buildPlan — явная раскладка (§234.1)', () => {
  it('раскладка математики владельца: 118 подтем, 118 файлов, без проблем', () => {
    const { subtopics, problems } = buildPlan(mathMapping)
    expect(problems).toEqual([])
    expect(summarizePlan(subtopics)).toEqual({ subtopics: 118, files: 118, topics: 19 })
    const codes = subtopics.map((s: { code: string }) => s.code)
    expect(codes).toEqual([...codes].sort(compareSubtopicCodes))
    expect(codes.slice(0, 3)).toEqual(['1.0', '1.1', '1.2'])
  })

  it('роль и подпись — из раскладки, позиция — порядок файла, заголовок «Подпись · код»', () => {
    const { subtopics, problems } = buildPlan(explicit([
      msub('1.2', [{ name: '02_Площадь_треугольника.pdf', section: 'tasks', label: 'Задачи' }]),
      msub('1.0', [{ name: '00_Теория.pdf', section: 'theory', label: 'Теория' }]),
      msub('2.5', [
        { name: 'a.pdf', section: 'theory', label: 'Теория' },
        { name: 'b.pdf', section: 'tasks' },
      ]),
    ]))
    expect(problems).toEqual([])
    expect(subtopics.map((s: { code: string }) => s.code)).toEqual(['1.0', '1.2', '2.5'])
    expect(subtopics[1].files).toEqual([{
      fileName: '02_Площадь_треугольника.pdf', relPath: 'ЕГЭ математика/Задание 01. Планиметрия/02_Площадь_треугольника.pdf',
      section: 'tasks', position: 0, title: 'Задачи · 1.2',
    }])
    // Нет подписи — подпись роли; позиции 0, 1 по порядку в подтеме.
    expect(subtopics[2].files.map((f: { position: number; title: string }) => [f.position, f.title]))
      .toEqual([[0, 'Теория · 2.5'], [1, 'Список задач · 2.5']])
  })

  it('два файла одной рубрики — проблема, подтема в план не входит', () => {
    const { subtopics, problems } = buildPlan(explicit([
      msub('1.1', [{ name: 'a.pdf', section: 'tasks', label: 'Задачи' }, { name: 'b.pdf', section: 'tasks', label: 'Задачи' }]),
    ]))
    expect(subtopics).toEqual([])
    expect(problems).toEqual([expect.stringMatching(/«b\.pdf» — второй файл рубрики tasks/)])
  })

  it('неизвестная рубрика — проблема', () => {
    const { subtopics, problems } = buildPlan(explicit([msub('1.1', [{ name: 'a.pdf', section: 'notes', label: 'Конспект' }])]))
    expect(subtopics).toEqual([])
    expect(problems).toEqual([expect.stringMatching(/рубрика «notes» не из списка тренировки/)])
  })

  it('пустая рубрика, файл без имени и подтема без файлов — проблемы', () => {
    const { subtopics, problems } = buildPlan(explicit([
      msub('1.1', [{ name: 'a.pdf', section: '', label: 'Задачи' }]),
      msub('1.2', [{ section: 'tasks', label: 'Задачи' }]),
      msub('1.3', []),
      msub('1.4', [{ name: 'ok.pdf', section: 'tasks', label: 'Задачи' }]),
    ]))
    expect(subtopics.map((s: { code: string }) => s.code)).toEqual(['1.4'])
    expect(problems).toEqual([
      expect.stringMatching(/^1\.1 .*«a\.pdf» — не указана рубрика/),
      expect.stringMatching(/^1\.2 .*файл №1 — не указано имя/),
      expect.stringMatching(/^1\.3 .*нет ни одного файла/),
    ])
  })

  it('прежние общие проверки действуют: код уникален, тема и папка указаны', () => {
    const f = [{ name: 'a.pdf', section: 'tasks', label: 'Задачи' }]
    const { subtopics, problems } = buildPlan(explicit([
      msub('1.1', f), msub('1.1', f), msub('1.2', f, { template_topic_id: null }), msub('1.3', f, { folder: '' }), msub('', f),
    ]))
    expect(subtopics.map((s: { code: string }) => s.code)).toEqual(['1.1'])
    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toMatch(/дважды[\s\S]*не указана тема шаблона[\s\S]*не указана папка[\s\S]*нет номера подтемы/)
  })

  it('--only и идемпотентность — как у физики (тема + код + рубрика)', () => {
    const { subtopics } = buildPlan(mathMapping, { only: ['1.2'] })
    expect(subtopics).toHaveLength(1)
    const [s] = subtopics
    expect(s.files.map((f: { section: string; title: string }) => [f.section, f.title])).toEqual([['tasks', 'Задачи · 1.2']])
    expect(missingFiles(s, [])).toHaveLength(1)
    expect(missingFiles(s, [{ topic_id: s.topicId, subtopic_code: '1.2', section: 'tasks' }])).toEqual([])
    const [row] = insertRows(s, [{ file: s.files[0], storagePath: 'p', size: 1 }], 'owner')
    expect(row).toMatchObject({ track: 'training', subtopic_code: '1.2', section: 'tasks', position: 0, title: 'Задачи · 1.2' })
  })

  it('физическая раскладка без поля format по-прежнему строгая: файлы-объекты в ней — проблема', () => {
    const { subtopics, problems } = buildPlan({ subtopics: [msub('1.1', [{ name: '00_Теория.pdf', section: 'theory' }])] })
    expect(subtopics).toEqual([])
    expect(problems[0]).toMatch(/не по шаблону/)
  })
})

describe('§236: «явная» раскладка на дорожке курса (track = ege)', () => {
  const real = JSON.parse(readFileSync(join(__dirname, '../../../scripts/oformlenie-physics-mapping.json'), 'utf8'))

  it('методички «Оформление»: 5 подтем, дорожка ege, заголовок без кода', () => {
    const { subtopics, problems } = buildPlan(real)
    expect(problems).toEqual([])
    expect(subtopics).toHaveLength(5)
    for (const s of subtopics) expect(s.track).toBe('ege')
    const s21 = subtopics.find((s: { code: string }) => s.code === "21")!
    expect(s21.files[0]).toMatchObject({ section: 'theory', position: 0, title: 'Правила оформления №21' })
    const rows = insertRows(s21, [{ file: s21.files[0], storagePath: 'p/x.pdf', size: 10 }], 'owner')
    expect(rows[0]).toMatchObject({ track: 'ege', section: 'theory', title: 'Правила оформления №21' })
  })

  it('без track раскладка по-прежнему пишет тренировку', () => {
    const m = { ...real, track: undefined }
    const { subtopics } = buildPlan(m)
    expect(subtopics[0].track).toBe('training')
    const rows = insertRows(subtopics[0], [{ file: subtopics[0].files[0], storagePath: 'p', size: 1 }], 'o')
    expect(rows[0].track).toBe('training')
    expect(rows[0].title).toBe('Правила оформления №21 · 21')
  })

  it('track у обычной (физической) раскладки и неизвестный track — проблема', () => {
    expect(buildPlan({ track: 'ege', subtopics: [] }).problems.join(' ')).toMatch(/только в «явной»/)
    expect(buildPlan({ ...real, track: 'x' }).problems.join(' ')).toMatch(/допустимо ege или training/)
  })

  it('homework_tasks на дорожке ege отклоняется', () => {
    const m = { ...real, subtopics: [{ ...real.subtopics[0], files: [{ name: 'a.pdf', section: 'homework_tasks' }] }] }
    expect(buildPlan(m).problems.join(' ')).toMatch(/только у тренировки/)
  })
})
