import { describe, expect, it } from 'vitest'
import {
  answerView,
  answersDiverge,
  answersMatch,
  expectedOnlyView,
  normalizeAnswer,
  notesFromAnnotations,
  notesOfTask,
  orphanNotes,
  pendingFindings,
  reviewRowTone,
  uncheckedIds,
  verdictConflictsWithNotes,
  type ReviewNote,
} from '@/lib/reviewNotes'

/**
 * §209. Правила, из-за которых экран проверки, ученический разбор и PDF
 * показывают ОДНО И ТО ЖЕ. Здесь они названы один раз и проверяются без DOM.
 */

const note = (over: Partial<ReviewNote> & { id: string }): ReviewNote => ({
  taskNo: '13',
  text: 'Ошибка в отборе корней',
  page: 2,
  type: 'error',
  categoryLabel: 'Ошибка',
  ...over,
})

describe('сравнение ответов', () => {
  it('запятая и точка — одно число', () => {
    expect(answersMatch('3,5', '3.5')).toBe(true)
  })

  it('минус U+2212 и дефис — один знак', () => {
    expect(answersMatch('−2', '-2')).toBe(true)
  })

  it('неразрывный пробел и лишние пробелы не считаются расхождением', () => {
    expect(answersMatch('12 м/с', ' 12 м/с ')).toBe(true)
  })

  it('разные числа остаются разными', () => {
    expect(answersMatch('12', '30')).toBe(false)
    expect(normalizeAnswer('12')).not.toBe(normalizeAnswer('30'))
  })

  it('совпало — печатается одно число', () => {
    expect(answerView('3,5', '3.5')).toEqual({ student: '3,5', expected: null })
  })

  it('разошлось — печатаются оба', () => {
    expect(answerView('12', '30')).toEqual({ student: '12', expected: '30' })
  })

  it('эталона нет — прочерк вместо него, а не пустое место', () => {
    expect(answerView('12', null)).toEqual({ student: '12', expected: '—' })
  })

  it('нет ни ответа, ни эталона — один прочерк', () => {
    expect(answerView(null, null)).toEqual({ student: '—', expected: null })
  })

  it('ученику печатается только правильный ответ', () => {
    expect(expectedOnlyView('30')).toBe('30')
    expect(expectedOnlyView(null)).toBe('—')
  })
})

describe('замечания и задания', () => {
  it('«№ 13», «13.» и «13» — одно задание', () => {
    const notes = [note({ id: 'n1', taskNo: '№ 13' }), note({ id: 'n2', taskNo: '13.' })]
    expect(notesOfTask(notes, '13').map(n => n.id)).toEqual(['n1', 'n2'])
  })

  it('замечание без задания и замечание к чужому номеру — «без задания»', () => {
    const notes = [note({ id: 'n1', taskNo: null }), note({ id: 'n2', taskNo: '99' }), note({ id: 'n3', taskNo: '13' })]
    expect(orphanNotes(notes, [{ no: '13' }]).map(n => n.id)).toEqual(['n1', 'n2'])
  })
})

describe('расхождение вердикта и замечания', () => {
  it('«верно» и замечание-ошибка — расхождение', () => {
    expect(verdictConflictsWithNotes('correct', [note({ id: 'n1' })])).toBe(true)
  })

  it('«верно» и похвала — не расхождение', () => {
    expect(verdictConflictsWithNotes('correct', [note({ id: 'n1', type: 'good' })])).toBe(false)
  })

  it('«верно» и старая заметка без типа — расхождение: молчать тут дороже', () => {
    expect(verdictConflictsWithNotes('correct', [note({ id: 'n1', type: null })])).toBe(true)
  })

  it('«неверно» с замечанием — обычное дело, не расхождение', () => {
    expect(verdictConflictsWithNotes('wrong', [note({ id: 'n1' })])).toBe(false)
  })

  it('пустой текст замечания ничему не противоречит', () => {
    expect(verdictConflictsWithNotes('correct', [note({ id: 'n1', text: '  ' })])).toBe(false)
  })
})

describe('находки ИИ — предложения', () => {
  const findings = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }]

  it('принятые и отклонённые больше не предлагаются', () => {
    expect(pendingFindings(findings, ['f1'], ['f2']).map(f => f.id)).toEqual(['f3'])
  })

  it('пока решения нет — предложение живёт', () => {
    expect(pendingFindings(findings, [], []).map(f => f.id)).toEqual(['f1', 'f2', 'f3'])
  })
})

describe('замечания из пометок работы', () => {
  const page = (filePath: string, pageNo: number, objects: unknown[]) => ({
    file_path: filePath,
    page: pageNo,
    data: { version: 2, objects },
  })

  it('регион с номером задания становится замечанием', () => {
    const notes = notesFromAnnotations(
      [page('a.jpg', 1, [{ id: 'r1', type: 'region', text: 'Знак', category: 'error', task: '13' }])],
      ['a.jpg'],
    )
    expect(notes).toEqual([
      { id: 'r1', taskNo: '13', text: 'Знак', page: 1, type: 'error', categoryLabel: 'Ошибка' },
    ])
  })

  it('старые категории читаются, но типа из тройки у них нет', () => {
    const notes = notesFromAnnotations(
      [page('a.jpg', 1, [{ id: 'r1', type: 'region', text: 'Знак', category: 'logic' }])],
      ['a.jpg'],
    )
    expect(notes[0].type).toBeNull()
    expect(notes[0].categoryLabel).toBe('Логическая ошибка')
    expect(notes[0].taskNo).toBeNull()
  })

  it('страницы считаются сквозным номером — файл за файлом', () => {
    const notes = notesFromAnnotations(
      [
        page('a.jpg', 1, [{ id: 'r1', type: 'region', text: 'первый файл', category: 'error' }]),
        page('b.jpg', 1, [{ id: 'r2', type: 'region', text: 'второй файл', category: 'error' }]),
      ],
      ['a.jpg', 'b.jpg'],
    )
    expect(notes.map(n => [n.id, n.page])).toEqual([['r1', 1], ['r2', 2]])
  })

  it('легаси-штрихи и мусор в jsonb не ломают чтение', () => {
    const notes = notesFromAnnotations(
      [page('a.jpg', 1, [{ id: 's1', type: 'stroke', points: [] }, null, 'нет'])],
      ['a.jpg'],
    )
    expect(notes).toEqual([])
  })
})

describe('пакетное действие', () => {
  it('в пачку попадают только несверенные', () => {
    expect(uncheckedIds([
      { id: 'a', verdict: 'unchecked' },
      { id: 'b', verdict: 'correct' },
      { id: 'c', verdict: 'unchecked' },
    ])).toEqual(['a', 'c'])
  })
})

/**
 * §212. Чем красится строка задания.
 *
 * Владелец: три проблемных задания из двадцати должны цепляться глазом без
 * чтения. Значит, красится вся строка, а не значок, — и красится только по
 * делу: отсутствие эталона не расхождение, а отсутствие сведений.
 */
describe('answersDiverge', () => {
  it('разные записи одного числа расхождением не считаются', () => {
    expect(answersDiverge('3,5', '3.5')).toBe(false)
    expect(answersDiverge('−2', '-2')).toBe(false)
  })

  it('настоящее расхождение', () => {
    expect(answersDiverge('12', '30')).toBe(true)
  })

  it('чего-то из двух нет — это не расхождение', () => {
    expect(answersDiverge(null, '30')).toBe(false)
    expect(answersDiverge('12', null)).toBe(false)
    expect(answersDiverge('  ', '30')).toBe(false)
  })
})

describe('reviewRowTone', () => {
  const errorNote: ReviewNote = {
    id: 'n1', taskNo: '1', text: 'Ход решения неверен', page: 2,
    type: 'error', categoryLabel: 'Ошибка',
  }

  it('спор вердикта с замечанием сильнее расхождения ответов', () => {
    expect(reviewRowTone(
      { verdict: 'correct', student_answer: '12', expected_answer: '30' },
      [errorNote],
    )).toBe('conflict')
  })

  it('ответ разошёлся — расхождение, даже если вердикт ещё не поставлен', () => {
    expect(reviewRowTone({ verdict: 'partial', student_answer: '12', expected_answer: '30' }, []))
      .toBe('mismatch')
  })

  it('«неверно» красится и при сошедшихся ответах — вердикт ставил человек', () => {
    expect(reviewRowTone({ verdict: 'wrong', student_answer: '12', expected_answer: '12' }, []))
      .toBe('mismatch')
  })

  it('верное задание без замечаний не подсвечено', () => {
    expect(reviewRowTone({ verdict: 'correct', student_answer: '12', expected_answer: '12' }, []))
      .toBe('none')
    expect(reviewRowTone({ verdict: 'unchecked', student_answer: null, expected_answer: '16,5' }, []))
      .toBe('none')
  })
})
