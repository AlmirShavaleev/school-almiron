import { describe, expect, it } from 'vitest'
import {
  reviewTasksScore,
  taskPoints,
  taskPointsText,
  uncheckedNote,
  uncheckedTaskNos,
  REVIEW_TASK_VERDICTS,
  type ReviewTaskVerdict,
} from '@/lib/homeworkReviewTasks'
import { nextPendingRow, queuePosition, reviewHeaderMeta, type QueueRow } from '@/lib/homeworkQueue'
import { FRAME_LABEL_MAX, VERDICT_FRAME_COLOR, frameLabel, frameLookOf, verdictsByTask } from '@/lib/reviewFrameLook'
import { barCommentMaxHeight, commentBoxMaxHeight, COMMENT_MIN_MAX_HEIGHT } from '@/lib/reviewCommentBox'

/**
 * §226. Чистые помощники экрана проверки v2: вклад задания в балл, подпись
 * про несверенные, место в очереди и «Следующая работа», шапка, вид рамок,
 * потолок поля комментария в нижней строке.
 */

describe('вклад задания в балл', () => {
  it('верно 1, частично ½, неверно и «не решено» 0, «не сверено» — не посчитано', () => {
    expect(taskPoints('correct')).toBe(1)
    expect(taskPoints('partial')).toBe(0.5)
    expect(taskPoints('wrong')).toBe(0)
    expect(taskPoints('unsolved')).toBe(0)
    expect(taskPoints('unchecked')).toBeNull()
    expect(REVIEW_TASK_VERDICTS.map(taskPointsText)).toEqual(['1', '0', '½', '?', '0'])
  })

  it('сумма вкладов — та же доля, из которой §180 считает балл', () => {
    const rows: { verdict: ReviewTaskVerdict }[] = [
      { verdict: 'correct' }, { verdict: 'correct' }, { verdict: 'partial' },
      { verdict: 'wrong' }, { verdict: 'unchecked' }, { verdict: 'unsolved' },
    ]
    const counted = rows.filter(r => taskPoints(r.verdict) != null)
    const sum = counted.reduce((acc, r) => acc + (taskPoints(r.verdict) ?? 0), 0)
    expect(sum / counted.length).toBeCloseTo(reviewTasksScore(rows, 'hundred').ratio ?? -1, 10)
  })
})

describe('подпись про несверенные', () => {
  it('номера в порядке таблицы', () => {
    expect(uncheckedTaskNos([
      { no: '2', verdict: 'correct' }, { no: '6', verdict: 'unchecked' }, { no: '9', verdict: 'unchecked' },
    ])).toEqual(['6', '9'])
  })

  it('одно, несколько, много', () => {
    expect(uncheckedNote([])).toBeNull()
    expect(uncheckedNote(['6'])).toBe('№6 ещё не сверено')
    expect(uncheckedNote(['3', '6'])).toBe('№3, 6 ещё не сверены')
    expect(uncheckedNote(['1', '2', '3', '4', '5'])).toBe('5 заданий ещё не сверено')
    expect(uncheckedNote(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']))
      .toBe('21 задание ещё не сверено')
  })
})

function row(id: string, status: string, over: Partial<QueueRow> = {}): QueueRow {
  return {
    attempt: {
      id, homework_id: 'hw', student_id: 's', attempt_number: 1, status,
      submitted_at: '2026-09-22T08:05:00Z', created_at: '', updated_at: '',
    } as QueueRow['attempt'],
    history: [],
    homeworkId: 'hw',
    homeworkTitle: 'ДЗ №13',
    gradeScale: 'five',
    dueAt: null,
    topicId: 't',
    topicTitle: 'Отбор корней',
    courseId: 'c',
    courseTitle: '11А · Профиль',
    ...over,
  }
}

describe('место в очереди и «Следующая работа»', () => {
  const rows = [row('a', 'submitted'), row('b', 'accepted'), row('c', 'submitted'), row('d', 'submitted')]

  it('номер считается по видимому списку', () => {
    expect(queuePosition(rows, 'c')).toEqual({ index: 3, total: 4 })
    expect(queuePosition(rows, 'нет')).toBeNull()
  })

  it('следующая — непроверенная после открытой, проверенные пропускаются', () => {
    expect(nextPendingRow(rows, 'a')?.attempt.id).toBe('c')
    expect(nextPendingRow(rows, 'b')?.attempt.id).toBe('c')
  })

  it('с конца списка — к пропущенным в начале, себя не предлагает', () => {
    expect(nextPendingRow(rows, 'd')?.attempt.id).toBe('a')
    expect(nextPendingRow([row('a', 'submitted')], 'a')).toBeNull()
  })

  it('открытой работы в списке нет — «следующей» тоже нет, догадок не строим', () => {
    expect(nextPendingRow(rows, 'чужая')).toBeNull()
  })
})

describe('шапка проверки', () => {
  const photos = [
    { mime_type: 'image/jpeg', file_name: '1.jpg' },
    { mime_type: 'image/jpeg', file_name: '2.jpg' },
  ]

  it('тема, группа, когда сдано, в срок, сколько фото', () => {
    const meta = reviewHeaderMeta(row('a', 'submitted', { dueAt: '2026-09-23T00:00:00Z' }), photos)
    expect(meta).toMatch(/^Отбор корней · 11А · Профиль · сдано 22 сентября в \d\d:05, в срок · 2 фото$/)
  })

  it('с опозданием — так и написано; без срока — ни «в срок», ни «с опозданием»', () => {
    expect(reviewHeaderMeta(row('a', 'submitted', { dueAt: '2026-09-20T00:00:00Z' }), photos)).toContain(', с опозданием')
    const noDue = reviewHeaderMeta(row('a', 'submitted'), photos)
    expect(noDue).not.toContain('в срок')
    expect(noDue).not.toContain('опоздан')
  })

  it('не только фото — «файлы», вторая попытка — номер', () => {
    const meta = reviewHeaderMeta(
      row('a', 'submitted', { attempt: { ...row('a', 'submitted').attempt, attempt_number: 2 } }),
      [...photos, { mime_type: 'application/pdf', file_name: 'x.pdf' }],
    )
    expect(meta).toContain('попытка №2')
    expect(meta).toContain('3 файла')
  })
})

describe('рамки на фото', () => {
  const verdicts = verdictsByTask([
    { no: '3', verdict: 'partial' }, { no: '№ 6', verdict: 'unchecked' }, { no: '4', verdict: 'wrong' },
  ])

  it('цвет — вердикт задания, «не сверено» пунктиром', () => {
    expect(frameLookOf({ task: '3', text: 'не отобран −7π/6' }, verdicts))
      .toMatchObject({ color: VERDICT_FRAME_COLOR.partial, dashed: false, label: '3 · не отобран −7π/6' })
    expect(frameLookOf({ task: '6', text: '' }, verdicts)).toMatchObject({ dashed: true, label: '6' })
    expect(frameLookOf({ task: '4', text: 'знак' }, verdicts)?.color).toBe(VERDICT_FRAME_COLOR.wrong)
  })

  it('без задания или без таблицы — рамка по-старому', () => {
    expect(frameLookOf({ task: null, text: 'Отлично' }, verdicts)).toBeNull()
    expect(frameLookOf({ task: '99', text: 'x' }, verdicts)).toBeNull()
    expect(frameLookOf({ task: '3', text: 'x' }, null)).toBeNull()
  })

  it('длинная подпись обрезается многоточием', () => {
    const label = frameLabel('3', 'а'.repeat(100))
    expect(label.startsWith('3 · ')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBe('3 · '.length + FRAME_LABEL_MAX)
  })
})

describe('поле комментария в нижней строке', () => {
  it('с ноутбука — четверть окна, но не ниже общего предела', () => {
    expect(barCommentMaxHeight(1280, 800)).toBe(200)
    expect(barCommentMaxHeight(1440, 900)).toBe(225)
    expect(barCommentMaxHeight(1280, 500)).toBe(COMMENT_MIN_MAX_HEIGHT)
    expect(barCommentMaxHeight(1280, 800)).toBeLessThan(commentBoxMaxHeight(800))
  })

  it('на телефоне — седьмая часть окна со своим нижним пределом', () => {
    expect(barCommentMaxHeight(390, 844)).toBe(118)
    expect(barCommentMaxHeight(390, 500)).toBe(96)
  })
})
