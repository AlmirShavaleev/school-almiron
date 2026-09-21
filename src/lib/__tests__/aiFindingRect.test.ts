import { describe, expect, it } from 'vitest'
import {
  findingTransferRect,
  unionFindingRect,
  type AiFindingRow,
  type AiTaskRow,
} from '@/lib/aiHomeworkCheck'

/**
 * §212. Какая рамка встаёт на работу, когда нажали «взять».
 *
 * Владелец просил обводить задание целиком. Границ задания модель не
 * возвращает и обещать их нельзя — поэтому дешёвый и честный путь: когда ИИ
 * поставила заданию «неверно» и нашла на нём НЕСКОЛЬКО мест, рамкой
 * становится описанный вокруг них прямоугольник.
 *
 * Что здесь легко потерять и потому проверяется: одна находка остаётся
 * ровно собой (описывать прямоугольник вокруг самого себя незачем);
 * «частично» и «верно» не объединяются вовсе; находки с разных страниц и
 * разных файлов не склеиваются — рамка живёт на странице.
 */

const finding = (over: Partial<AiFindingRow> & { id: string }): AiFindingRow => ({
  job_id: 'j1',
  file_id: 'file1',
  page: 2,
  rect_x: 0.1,
  rect_y: 0.1,
  rect_w: 0.2,
  rect_h: 0.1,
  category: 'calc',
  text: 'ошибка',
  position: 0,
  task: '13',
  ...over,
})

const task = (no: string, verdict: AiTaskRow['verdict']): AiTaskRow => ({
  no,
  verdict,
  student_answer: '',
  expected_answer: '',
  note: '',
})

describe('unionFindingRect', () => {
  it('описанный прямоугольник по двум рамкам', () => {
    expect(unionFindingRect([
      finding({ id: 'f1', rect_x: 0.1, rect_y: 0.2, rect_w: 0.2, rect_h: 0.1 }),
      finding({ id: 'f2', rect_x: 0.5, rect_y: 0.1, rect_w: 0.2, rect_h: 0.4 }),
    ])).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.4 })
  })

  it('вложенная рамка ничего не меняет', () => {
    expect(unionFindingRect([
      finding({ id: 'f1', rect_x: 0.1, rect_y: 0.1, rect_w: 0.5, rect_h: 0.5 }),
      finding({ id: 'f2', rect_x: 0.2, rect_y: 0.2, rect_w: 0.1, rect_h: 0.1 }),
    ])).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('считать не по чему — молчим, а не выдумываем ноль', () => {
    expect(unionFindingRect([])).toBeNull()
    expect(unionFindingRect([finding({ id: 'f1', rect_x: NaN })])).toBeNull()
  })
})

describe('findingTransferRect', () => {
  const tasks = [task('13', 'wrong'), task('7', 'partial'), task('9', 'correct')]

  const a = finding({ id: 'f1', rect_x: 0.1, rect_y: 0.2, rect_w: 0.2, rect_h: 0.1 })
  const b = finding({ id: 'f2', rect_x: 0.5, rect_y: 0.1, rect_w: 0.2, rect_h: 0.4 })

  it('«неверно» и две находки — рамка их объединение', () => {
    expect(findingTransferRect(a, [a, b], tasks)).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.4 })
    // Обе находки дают одну и ту же рамку: место у них общее.
    expect(findingTransferRect(b, [a, b], tasks)).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.4 })
  })

  it('одна находка — рамка ровно как была', () => {
    expect(findingTransferRect(a, [a], tasks)).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 })
  })

  it('вердикт не «неверно» — не объединяем: обещать «вся задача» нельзя', () => {
    const c = finding({ id: 'f3', task: '7', rect_x: 0.1, rect_y: 0.2, rect_w: 0.2, rect_h: 0.1 })
    const d = finding({ id: 'f4', task: '7', rect_x: 0.5, rect_y: 0.1, rect_w: 0.2, rect_h: 0.4 })
    expect(findingTransferRect(c, [c, d], tasks)).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 })
  })

  it('соседние страницы и другие файлы не склеиваются — рамка живёт на странице', () => {
    const other = finding({ id: 'f5', page: 3, rect_x: 0.5, rect_y: 0.1, rect_w: 0.2, rect_h: 0.4 })
    const alien = finding({ id: 'f6', file_id: 'file2', rect_x: 0.6, rect_y: 0.6, rect_w: 0.2, rect_h: 0.2 })
    expect(findingTransferRect(a, [a, other, alien], tasks)).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 })
  })

  it('находка ничьей строки — рамка своя', () => {
    const loose = finding({ id: 'f7', task: null, text: 'общее замечание' })
    expect(findingTransferRect(loose, [loose], tasks))
      .toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 })
  })

  it('таблицы заданий нет (проверка старее v17) — рамка своя', () => {
    expect(findingTransferRect(a, [a, b], null)).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 })
  })
})
