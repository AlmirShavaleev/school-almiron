import { describe, expect, it } from 'vitest'
import {
  type FeedbackFile,
  bindFeedback,
  buildFeedbackLayout,
  cropBand,
  joinTaskNos,
  sameNote,
  stripTaskPrefix,
  taskNoFromText,
  type FeedbackAnnotationRow,
} from '@/lib/attemptFeedback'
import type { ReviewTaskRow, ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'

/**
 * §239. Привязка рамок учителя к заданиям для разбора у ученика.
 *
 * Поле `task` у рамки на проде заполнено у 1 из 226 рамок, поэтому второй
 * источник — номер в начале текста; всё, что не привязалось, — «Общие
 * замечания». Номера пометок обязаны совпадать с аннотатором и PDF.
 */

const row = (no: string, verdict: ReviewTaskVerdict, over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: `row-${no}`, attempt_id: 'att', no, verdict, student_answer: null, expected_answer: null,
  note: null, position: Number(no.replace(/\D/g, '')) * 10 || 0, updated_by: null, updated_at: '', ...over,
})

const region = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'region', category: 'error', text, rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, ...extra,
})

const FILES: FeedbackFile[] = [
  { path: 'att/p1.jpg', kind: 'image' },
  { path: 'att/p2.jpg', kind: 'image' },
]

function layoutOf(rows: FeedbackAnnotationRow[], files: FeedbackFile[] = FILES, pdfPages: Record<string, number> = {}) {
  return buildFeedbackLayout(files, rows, pdfPages)
}

describe('номер задания из начала текста', () => {
  it.each([
    ['Задача 3: знак ускорения', '3'],
    ['Задача №3 — знак', '3'],
    ['задача № 12а. ответ', '12а'],
    ['№3 нет рисунка', '3'],
    ['№ 7: график', '7'],
    ['з.3 минус потерян', '3'],
    ['Задание 14 — проверь', '14'],
    ['Зад. 4 ответ без единиц', '4'],
  ])('«%s» → %s', (text, no) => {
    expect(taskNoFromText(text)).toBe(no)
  })

  it.each([
    'Как в задаче 3, здесь тоже знак',
    'Нет единиц измерения',
    'Ответ 3 м/с',
    '',
  ])('не начало текста или нет номера: «%s» → null', text => {
    expect(taskNoFromText(text)).toBeNull()
  })

  it('номер из начала убирается, первая буква — заглавная', () => {
    expect(stripTaskPrefix('Задача 3: знак ускорения отрицательный')).toBe('Знак ускорения отрицательный')
    expect(stripTaskPrefix('№7 — нет графика')).toBe('Нет графика')
    expect(stripTaskPrefix('Нет единиц')).toBe('Нет единиц')
  })
})

describe('привязка рамок к заданиям', () => {
  const rows = [row('1', 'correct'), row('3', 'wrong'), row('7', 'partial'), row('9', 'correct')]

  it('поле task главнее текста; без task — номер из текста; иначе — общее замечание', () => {
    const { regions } = layoutOf([{
      file_path: 'att/p1.jpg', page: 1,
      data: { objects: [
        region('a', 'Задача 7: на самом деле про третье', { task: '3' }),
        region('b', 'Задача 7: ответ верный, но график не построен'),
        region('c', 'Нет единиц измерения'),
        region('d', 'Задача 15: такой строки в таблице нет'),
      ] },
    }])
    const binding = bindFeedback(rows, regions)
    const byNo = Object.fromEntries(binding.tasks.map(t => [t.row.no, t.regions.map(r => r.id)]))
    expect(byNo['3']).toEqual(['a'])
    expect(byNo['7']).toEqual(['b'])
    expect(binding.general.map(g => g.region.id)).toEqual(['c', 'd'])
  })

  it('номер сравнивается после нормализации: «№ 3» и «3.» — то же задание', () => {
    const { regions } = layoutOf([{ file_path: 'att/p1.jpg', page: 1, data: { objects: [region('a', 'x', { task: '№ 3' })] } }])
    const binding = bindFeedback([row('3.', 'wrong')], regions)
    expect(binding.tasks[0].regions.map(r => r.id)).toEqual(['a'])
  })

  it('рамка засчитанного задания уходит в «Общие» с номером задания', () => {
    const { regions } = layoutOf([{ file_path: 'att/p2.jpg', page: 1, data: { objects: [region('n', '№9: нет единиц')] } }])
    const binding = bindFeedback(rows, regions)
    expect(binding.general).toEqual([expect.objectContaining({ taskNo: '9' })])
    expect(binding.general[0].region.id).toBe('n')
  })

  it('нет таблицы — все рамки общие, даже с номером', () => {
    const { regions } = layoutOf([{ file_path: 'att/p1.jpg', page: 1, data: { objects: [region('a', 'Задача 3: x', { task: '3' })] } }])
    const binding = bindFeedback([], regions)
    expect(binding.tasks).toEqual([])
    expect(binding.general.map(g => g.region.id)).toEqual(['a'])
    expect(binding.toFix).toBe(0)
  })

  it('исправить: неверно + частично + не решено; засчитанные — отдельно', () => {
    const binding = bindFeedback([...rows, row('12', 'unsolved')], [])
    expect(binding.toFix).toBe(3)
    expect(binding.cards.map(t => t.row.no)).toEqual(['3', '7', '12'])
    expect(binding.correct.map(t => t.row.no)).toEqual(['1', '9'])
  })

  it('заметка таблицы, повторяющая текст рамки, показывается один раз', () => {
    const { regions } = layoutOf([{
      file_path: 'att/p1.jpg', page: 1,
      data: { objects: [region('b', 'Задача 7: ответ верный, но график v(t) не построен — условие просит рисунок.')] },
    }])
    const binding = bindFeedback([
      row('3', 'wrong', { note: 'Другое замечание к третьему' }),
      row('7', 'partial', { note: 'Ответ верный, но график v(t) не построен' }),
    ], regions)
    expect(binding.tasks.find(t => t.row.no === '7')!.note).toBeNull()
    expect(binding.tasks.find(t => t.row.no === '3')!.note).toBe('Другое замечание к третьему')
  })

  it('похожие, но разные короткие тексты не склеиваются', () => {
    expect(sameNote('Верно', 'Верно, но без единиц измерения')).toBe(false)
    expect(sameNote('Знак', 'Знак ускорения отрицательный')).toBe(false)
    expect(sameNote('Задача 3: знак!', 'знак')).toBe(true)
    expect(sameNote('Знак ускорения при торможении', 'Задача 3: знак ускорения при торможении.')).toBe(true)
  })
})

describe('страницы, номера пометок и поворот', () => {
  it('номера идут по сквозной странице, внутри страницы — в порядке хранения', () => {
    const { regions, pages } = layoutOf([
      { file_path: 'att/p2.jpg', page: 1, data: { objects: [region('z', 'вторая страница')] } },
      { file_path: 'att/p1.jpg', page: 1, data: { objects: [region('x', 'первая'), region('y', 'первая, вторая рамка')] } },
    ])
    expect(pages.map(p => p.globalPage)).toEqual([1, 2])
    expect(regions.map(r => [r.id, r.number, r.globalPage])).toEqual([['x', 1, 1], ['y', 2, 1], ['z', 3, 2]])
  })

  it('PDF: страницы файла считаются по документу, когда он открыт', () => {
    const files: FeedbackFile[] = [{ path: 'att/work.pdf', kind: 'pdf' }, { path: 'att/p.jpg', kind: 'image' }]
    const rows = [{ file_path: 'att/p.jpg', page: 1, data: { objects: [region('p', 'фото')] } }]
    expect(layoutOf(rows, files).regions[0].globalPage).toBe(2)
    expect(layoutOf(rows, files, { 'att/work.pdf': 3 }).regions[0].globalPage).toBe(4)
  })

  it('повёрнутая страница: рамка на экране — в долях повёрнутого листа', () => {
    const { regions, pages } = layoutOf([{
      file_path: 'att/p1.jpg', page: 1,
      data: { rotation: 1, objects: [region('r', 'боком', { rect: { x: 0.29, y: 0.32, w: 0.05, h: 0.6 } })] },
    }])
    expect(pages[0].quarter).toBe(1)
    const shown = regions[0].displayRect
    expect(shown.x).toBeCloseTo(0.08)
    expect(shown.y).toBeCloseTo(0.29)
    expect(shown.w).toBeCloseTo(0.6)
    expect(shown.h).toBeCloseTo(0.05)
  })

  it('битая рамка (без размеров) и не-рамки пропускаются', () => {
    const { regions } = layoutOf([{
      file_path: 'att/p1.jpg', page: 1,
      data: { objects: [
        { id: 's', type: 'stroke', points: [] },
        region('bad', 'x', { rect: { x: 0.1, y: 0.1, w: 0, h: 0.2 } }),
        region('ok', 'x'),
      ] },
    }])
    expect(regions.map(r => r.id)).toEqual(['ok'])
  })
})

describe('вырезка', () => {
  it('отступ — не меньше полосы текста, по ширине лист целиком', () => {
    const band = cropBand({ x: 0.3, y: 0.5, w: 0.2, h: 0.05 })
    expect(band.top).toBeCloseTo(0.46)
    expect(band.height).toBeCloseTo(0.13)
  })

  it('у высокой рамки отступ — 15 % её высоты; у края листа не вылезает за него', () => {
    const tall = cropBand({ x: 0, y: 0.3, w: 1, h: 0.4 })
    expect(tall.top).toBeCloseTo(0.24)
    expect(tall.height).toBeCloseTo(0.52)
    const edge = cropBand({ x: 0, y: 0.01, w: 1, h: 0.05 })
    expect(edge.top).toBe(0)
    expect(edge.top + edge.height).toBeLessThanOrEqual(1)
  })

  it('подпись засчитанных: «№1 и №9», «№1, №3 и №9»', () => {
    expect(joinTaskNos(['9', '1'])).toBe('№1 и №9')
    expect(joinTaskNos(['1', '3', '9'])).toBe('№1, №3 и №9')
    expect(joinTaskNos(['5'])).toBe('№5')
  })
})
