/**
 * §222b. Чистая часть check-mock-exam-ai: номера второй части, тело запроса,
 * промпт (вариант ученика назван явно), разбор и проверка ответа модели,
 * рамки, приписка, пул на три ученика.
 */
import { describe, expect, it } from 'vitest'
import {
  CONCURRENCY,
  MAX_REGIONS_PER_TASK,
  buildPrompt,
  extractText,
  normalizeRegion,
  parseCheckRequest,
  parseJson,
  parseSuggestions,
  part2Tasks,
  runNote,
  runPool,
  type SentPage,
} from '../../../supabase/functions/check-mock-exam-ai/logic.ts'

const EX = '50000000-0000-0000-0000-000000000006'
const S1 = '20000000-0000-0000-0000-000000000051'
const S2 = '20000000-0000-0000-0000-000000000052'
// ЕГЭ профиль: 12 номеров первой части по 1 баллу, вторая часть 13–19.
const MAX = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4]
const TASKS = part2Tasks(MAX, 12)
const PAGES: SentPage[] = [
  { photo_id: 'ph1', page: 1, label: 'Фото 1' },
  { photo_id: 'ph2', page: 1, label: 'Фото 2, стр. 1' },
  { photo_id: 'ph2', page: 2, label: 'Фото 2, стр. 2' },
]

describe('номера второй части', () => {
  it('part1_last + 1 … конец шаблона, максимумы из шаблона', () => {
    expect(TASKS).toEqual([
      { task: 13, max: 2 }, { task: 14, max: 3 }, { task: 15, max: 2 }, { task: 16, max: 2 },
      { task: 17, max: 3 }, { task: 18, max: 4 }, { task: 19, max: 4 },
    ])
    expect(part2Tasks([1, 1, 2], 3)).toEqual([])
  })
})

describe('тело запроса', () => {
  it('пробник обязателен; ученики — список uuid без повторов; нет списка — «у всех»', () => {
    expect(parseCheckRequest({})).toEqual({ ok: false, error: 'Не передан идентификатор пробника' })
    expect(parseCheckRequest({ mock_exam_id: EX })).toEqual({ ok: true, mockExamId: EX, studentIds: null })
    expect(parseCheckRequest({ mock_exam_id: EX, student_ids: [S1, S1, S2] })).toEqual({ ok: true, mockExamId: EX, studentIds: [S1, S2] })
    expect(parseCheckRequest({ mock_exam_id: EX, student_ids: ['x'] }).ok).toBe(false)
    expect(parseCheckRequest({ mock_exam_id: EX, student_ids: [] }).ok).toBe(false)
    expect(parseCheckRequest({ mock_exam_id: EX, student_ids: S1 }).ok).toBe(false)
  })
})

describe('промпт', () => {
  const base = {
    examTitle: 'Пробник №6', variantPosition: 2, variantLabel: 'Резерв', variantCount: 3, tasks: TASKS,
    solutionText: 'Вариант 1 … Вариант 2: 13) x = π/2 …', solutionTruncated: false,
    criteriaText: '13 — 2 балла: обоснованно получены верные ответы', criteriaTruncated: false, pageCount: 3,
  }
  it('называет вариант ученика и требует брать решения только его', () => {
    const p = buildPrompt(base)
    expect(p).toContain('ВАРИАНТ УЧЕНИКА: вариант №2 («Резерв»).')
    expect(p).toContain('может содержать НЕСКОЛЬКО вариантов подряд')
    expect(p).toContain('ТОЛЬКО для вариант №2 («Резерв») (всего вариантов: 3)')
  })
  it('перечисляет номера второй части с максимумами шаблона, первую часть не проверяет', () => {
    const p = buildPrompt(base)
    expect(p).toContain('ПРОВЕРЯЙ ТОЛЬКО номера 13–19: №13 (максимум 2), №14 (максимум 3), №15 (максимум 2), №16 (максимум 2), №17 (максимум 3), №18 (максимум 4), №19 (максимум 4).')
    expect(p).toContain('Первую часть (ответы в бланк) не проверяй')
    expect(p).toContain('ДОЛИ СТРАНИЦЫ ОТ 0 ДО 1')
    expect(p).toContain('Тебе передано страниц: 3.')
    // Блоки эталона и критериев — общие с ДЗ (reference.ts).
    expect(p).toContain('АВТОРСКОЕ РЕШЕНИЕ УЧИТЕЛЯ (эталон):')
    expect(p).toContain('КРИТЕРИИ ОЦЕНИВАНИЯ')
  })
  it('без вариантов и без решения — честно', () => {
    const p = buildPrompt({ ...base, variantPosition: null, variantLabel: null, variantCount: 0, solutionText: '', criteriaText: '' })
    expect(p).toContain('Вариант у пробника один.')
    expect(p).not.toContain('НЕСКОЛЬКО вариантов')
    expect(p).toContain('АВТОРСКОГО РЕШЕНИЯ НЕТ')
    expect(p).toContain('КРИТЕРИЕВ НЕТ')
  })
})

describe('ответ модели', () => {
  it('текст ответа и JSON в обёртке ```json', () => {
    const text = extractText({ choices: [{ message: { content: '```json\n{"tasks":[]}\n```' } }] })
    expect(parseJson(text)).toEqual({ tasks: [] })
    expect(parseJson('не json')).toBeNull()
    expect(extractText({ choices: [{ message: { content: [{ text: '{"a":' }, { text: '1}' }] } }] })).toBe('{"a":1}')
  })

  it('валидация: балл в [0, максимум], целый; чужой номер и повтор — выброшены; null и нет номера — предложения нет', () => {
    const r = parseSuggestions({
      tasks: [
        { task: 13, points: 1, confidence: 'medium', comment: '  Потерян   корень ', regions: [{ page_index: 1, x: 0.1, y: 0.2, w: 0.5, h: 0.1 }] },
        { task: '14', points: '3', confidence: 'high', comment: 'Верно', regions: [] },
        { task: 15, points: 5, confidence: 'high' }, // больше максимума 2
        { task: 16, points: 1.5, confidence: 'low' }, // не целый
        { task: 17, points: null, confidence: 'low', comment: 'не читается' },
        { task: 13, points: 0 }, // повтор
        { task: 5, points: 1 }, // первая часть
        { task: '№18', points: 0, confidence: 'уверен' }, // уверенность не из трёх → low
      ],
    }, TASKS, PAGES)
    expect(r.rows).toEqual([
      { task_number: 13, points: 1, max_points: 2, confidence: 'medium', comment: 'Потерян корень', regions: [{ photo_id: 'ph1', page: 1, x: 0.1, y: 0.2, w: 0.5, h: 0.1 }] },
      { task_number: 14, points: 3, max_points: 3, confidence: 'high', comment: 'Верно', regions: [] },
      { task_number: 18, points: 0, max_points: 4, confidence: 'low', comment: null, regions: [] },
    ])
    expect(r.missing).toEqual([15, 16, 17, 19])
    expect(r.dropped).toEqual([
      '№15 — балл 5 вне 0…2',
      '№16 — балл «1.5» не целый',
      '№13 — повтор',
      '№5 — не номер второй части',
    ])
  })

  it('ноль — это балл (решения нет), а не «нет предложения»', () => {
    const r = parseSuggestions({ tasks: [{ task: 19, points: 0, confidence: 'high', comment: 'Решения нет' }] }, TASKS, PAGES)
    expect(r.rows.map(x => [x.task_number, x.points])).toEqual([[19, 0]])
  })

  it('пустой или кривой ответ — ни одной строки, все номера без предложения', () => {
    expect(parseSuggestions({}, TASKS, PAGES)).toEqual({ rows: [], missing: [13, 14, 15, 16, 17, 18, 19], dropped: [] })
    expect(parseSuggestions({ tasks: ['x'] }, TASKS, PAGES).dropped).toEqual(['строка не объект'])
  })
})

describe('рамки', () => {
  it('доли 0..1; страница → фото и страница PDF; выход за край обрезан', () => {
    expect(normalizeRegion({ page_index: 3, x: 0.7, y: 0.9, w: 0.6, h: 0.3 }, PAGES))
      .toEqual({ photo_id: 'ph2', page: 2, x: 0.7, y: 0.9, w: 0.3, h: 0.1 })
    // Вложенный rect — как у ДЗ.
    expect(normalizeRegion({ page_index: 2, rect: { x: 0, y: 0, w: 1, h: 0.5 } }, PAGES))
      .toEqual({ photo_id: 'ph2', page: 1, x: 0, y: 0, w: 1, h: 0.5 })
  })
  it('нет страницы, пиксели, нулевая рамка — выброшены', () => {
    expect(normalizeRegion({ page_index: 9, x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, PAGES)).toBeNull()
    expect(normalizeRegion({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, PAGES)).toBeNull()
    expect(normalizeRegion({ page_index: 1, x: 0.1, y: 0.1, w: 0, h: 0.1 }, PAGES)).toBeNull()
    expect(normalizeRegion({ page_index: 1, x: 1, y: 0.1, w: 0.3, h: 0.1 }, PAGES)).toBeNull()
    expect(normalizeRegion({ page_index: 1, x: 'a', y: 0.1, w: 0.3, h: 0.1 }, PAGES)).toBeNull()
    // Пиксели прижимаются к 1 и дают рамку нулевой ширины у правого края — выброшена.
    expect(normalizeRegion({ page_index: 1, x: 120, y: 40, w: 300, h: 50 }, PAGES)).toBeNull()
  })
  it('не больше MAX_REGIONS_PER_TASK на номер, кривые — поштучно', () => {
    const regions = [
      { page_index: 9, x: 0, y: 0, w: 0.1, h: 0.1 },
      ...Array.from({ length: 6 }, (_, i) => ({ page_index: 1, x: 0.1 * i, y: 0, w: 0.1, h: 0.1 })),
    ]
    const r = parseSuggestions({ tasks: [{ task: 13, points: 2, confidence: 'high', regions }] }, TASKS, PAGES)
    expect(r.rows[0].regions).toHaveLength(MAX_REGIONS_PER_TASK)
    expect(r.rows[0].regions[0].x).toBe(0)
  })
})

describe('приписка к прогону', () => {
  it('без решения, пропущенные фото, номера без предложения', () => {
    expect(runNote({ solution: 'used', criteria: 'used', skipped: [], missing: [], dropped: [] })).toBeNull()
    expect(runNote({ solution: 'missing', criteria: 'missing', skipped: ['Фото 3 — файл не скачался'], missing: [17, 19], dropped: [] }))
      .toBe('Проверено без решения: у варианта нет PDF решений. Не всё фото дошло до модели: Фото 3 — файл не скачался. Без предложения: №17, №19 — поставьте сами.')
  })
})

describe('пул', () => {
  it(`не больше ${CONCURRENCY} одновременно, порядок результатов — порядок входа`, async () => {
    let active = 0
    let peak = 0
    const out = await runPool([1, 2, 3, 4, 5, 6, 7], CONCURRENCY, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5 * (8 - n)))
      active -= 1
      return n * 10
    })
    expect(peak).toBe(3)
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70])
  })
})
