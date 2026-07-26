import { describe, it, expect } from 'vitest'
import {
  ATTEMPT_STATUS_LABEL,
  TEACHER_ATTEMPT_STATUS_LABEL,
  groupAttemptsByStudent,
  isReviewable,
  acceptedAttempt,
  activeAttempt,
  attemptsNewestFirst,
  buildAttemptFilePath,
  buildHomeworkFilePath,
  canStartNewAttempt,
  formatBytes,
  formatDue,
  gradeScaleMax,
  isOverdue,
  latestReview,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkAttemptStatus,
  type TopicHomeworkReviewRow,
} from './topicHomework'

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const ATTEMPT = 'a0000000-0000-0000-0000-000000000001'

const attempt = (n: number, status: TopicHomeworkAttemptStatus): TopicHomeworkAttemptRow => ({
  id: 'att-' + n,
  homework_id: 'hw',
  student_id: 'stu',
  attempt_number: n,
  status,
  submitted_at: status === 'draft' ? null : '2026-07-26T10:00:00Z',
  created_at: '2026-07-26T09:00:00Z',
  updated_at: '2026-07-26T10:00:00Z',
})

// ── Понятные статусы ─────────────────────────────────────────────────────────

describe('подписи статусов', () => {
  it('все четыре статуса переведены', () => {
    expect(ATTEMPT_STATUS_LABEL.draft).toBe('Черновик')
    expect(ATTEMPT_STATUS_LABEL.submitted).toBe('Отправлено')
    expect(ATTEMPT_STATUS_LABEL.returned_for_revision).toBe('На доработке')
    expect(ATTEMPT_STATUS_LABEL.accepted).toBe('Принято')
  })
})

describe('подписи статусов для преподавателя', () => {
  it('submitted у преподавателя — «На проверке», у ученика — «Отправлено»', () => {
    expect(TEACHER_ATTEMPT_STATUS_LABEL.submitted).toBe('На проверке')
    expect(ATTEMPT_STATUS_LABEL.submitted).toBe('Отправлено')
  })
  it('возврат и принятие названы одинаково для обоих', () => {
    expect(TEACHER_ATTEMPT_STATUS_LABEL.returned_for_revision).toBe('На доработке')
    expect(TEACHER_ATTEMPT_STATUS_LABEL.accepted).toBe('Принято')
  })
})

describe('isReviewable', () => {
  it('проверять можно только сданную попытку', () => {
    expect(isReviewable(attempt(1, 'submitted'))).toBe(true)
    expect(isReviewable(attempt(1, 'draft'))).toBe(false)
    expect(isReviewable(attempt(1, 'returned_for_revision'))).toBe(false)
    expect(isReviewable(attempt(1, 'accepted'))).toBe(false)
  })
})

describe('groupAttemptsByStudent', () => {
  const withStudent = (id: string, student: string, n: number, status: any) => ({
    ...attempt(n, status), id, student_id: student,
  })

  it('группирует по ученикам, последняя попытка становится текущей', () => {
    const rows = [
      withStudent('a1', 's1', 1, 'returned_for_revision'),
      withStudent('a2', 's1', 2, 'submitted'),
      withStudent('a3', 's2', 1, 'accepted'),
    ]
    const groups = groupAttemptsByStudent(rows)
    expect(groups).toHaveLength(2)
    const s1 = groups.find(g => g.studentId === 's1')!
    expect(s1.latest.attempt_number).toBe(2)
    expect(s1.history.map(h => h.attempt_number)).toEqual([1])
  })

  it('черновики выбрасываются', () => {
    expect(groupAttemptsByStudent([withStudent('a1', 's1', 1, 'draft')])).toHaveLength(0)
  })

  it('ждущие проверки идут первыми, принятые последними', () => {
    const rows = [
      withStudent('a1', 's1', 1, 'accepted'),
      withStudent('a2', 's2', 1, 'returned_for_revision'),
      withStudent('a3', 's3', 1, 'submitted'),
    ]
    expect(groupAttemptsByStudent(rows).map(g => g.latest.status))
      .toEqual(['submitted', 'returned_for_revision', 'accepted'])
  })

  it('пустой вход — пустой список', () => {
    expect(groupAttemptsByStudent([])).toEqual([])
  })
})

// ── Жизненный цикл сдачи ─────────────────────────────────────────────────────

describe('активная попытка', () => {
  it('черновик считается активным', () => {
    expect(activeAttempt([attempt(1, 'draft')])?.attempt_number).toBe(1)
  })

  it('отправленная считается активной — ученик ждёт проверки', () => {
    expect(activeAttempt([attempt(1, 'submitted')])?.attempt_number).toBe(1)
  })

  it('возвращённая и принятая активными не считаются', () => {
    expect(activeAttempt([attempt(1, 'returned_for_revision')])).toBeNull()
    expect(activeAttempt([attempt(1, 'accepted')])).toBeNull()
  })

  it('среди истории находит именно незавершённую', () => {
    const list = [attempt(1, 'returned_for_revision'), attempt(2, 'draft')]
    expect(activeAttempt(list)?.attempt_number).toBe(2)
  })
})

describe('canStartNewAttempt — показывать ли кнопку новой сдачи', () => {
  it('попыток нет — можно начать', () => {
    expect(canStartNewAttempt([])).toBe(true)
  })

  it('после возврата — можно сдать заново', () => {
    expect(canStartNewAttempt([attempt(1, 'returned_for_revision')])).toBe(true)
  })

  it('после принятия — нельзя', () => {
    expect(canStartNewAttempt([attempt(1, 'accepted')])).toBe(false)
  })

  it('принятая среди истории закрывает пересдачу насовсем', () => {
    const list = [attempt(1, 'returned_for_revision'), attempt(2, 'accepted')]
    expect(canStartNewAttempt(list)).toBe(false)
    expect(acceptedAttempt(list)?.attempt_number).toBe(2)
  })

  it('пока есть черновик или отправленная — вторую не начинаем', () => {
    expect(canStartNewAttempt([attempt(1, 'draft')])).toBe(false)
    expect(canStartNewAttempt([attempt(1, 'submitted')])).toBe(false)
  })
})

describe('история попыток', () => {
  it('сортируется от новой к старой', () => {
    const list = [attempt(1, 'returned_for_revision'), attempt(3, 'draft'), attempt(2, 'returned_for_revision')]
    expect(attemptsNewestFirst(list).map(a => a.attempt_number)).toEqual([3, 2, 1])
  })

  it('не мутирует исходный массив', () => {
    const list = [attempt(1, 'draft'), attempt(2, 'draft')]
    attemptsNewestFirst(list)
    expect(list.map(a => a.attempt_number)).toEqual([1, 2])
  })
})

describe('latestReview — комментарий преподавателя', () => {
  const review = (id: string, attemptId: string, at: string, comment: string): TopicHomeworkReviewRow => ({
    id, attempt_id: attemptId, reviewer_id: 'teacher',
    decision: 'returned_for_revision', comment, created_at: at,
  })

  it('берёт самый свежий вердикт по попытке', () => {
    const reviews = [
      review('r1', ATTEMPT, '2026-07-26T10:00:00Z', 'первый'),
      review('r2', ATTEMPT, '2026-07-26T12:00:00Z', 'второй'),
    ]
    expect(latestReview(reviews, ATTEMPT)?.comment).toBe('второй')
  })

  it('не путает попытки', () => {
    const reviews = [review('r1', 'другая', '2026-07-26T10:00:00Z', 'чужой')]
    expect(latestReview(reviews, ATTEMPT)).toBeNull()
  })

  it('нет вердикта — null, а не падение', () => {
    expect(latestReview([], ATTEMPT)).toBeNull()
  })
})

// ── Пути в storage ───────────────────────────────────────────────────────────

describe('пути файлов', () => {
  it('задание кладётся в папку темы — на этом держится storage-политика', () => {
    const path = buildHomeworkFilePath(TOPIC, 'zadanie.pdf', 1700000000000)
    expect(path.split('/')[0]).toBe(TOPIC)
    expect(path).toBe(`${TOPIC}/1700000000000_zadanie.pdf`)
  })

  it('работа ученика кладётся в папку попытки', () => {
    const path = buildAttemptFilePath(ATTEMPT, 'scan.jpg', 1)
    expect(path.split('/')[0]).toBe(ATTEMPT)
  })

  it('слэши в имени не дают уйти в чужую папку', () => {
    const path = buildAttemptFilePath(ATTEMPT, '../../other/hack.pdf', 1)
    expect(path.split('/').length).toBe(2)
    expect(path.split('/')[0]).toBe(ATTEMPT)
  })

  it('пробелы заменяются', () => {
    expect(buildHomeworkFilePath(TOPIC, 'моя работа.pdf', 1)).toBe(`${TOPIC}/1_moya_rabota.pdf`)
  })
})

describe('formatBytes', () => {
  it('форматирует размеры', () => {
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(2048)).toBe('2 КБ')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ')
  })
  it('null остаётся null', () => {
    expect(formatBytes(null)).toBeNull()
  })
})

// ── Дедлайны и баллы ──────────────────────────────────────────────────────────

describe('gradeScaleMax', () => {
  it('пятибалльная шкала → 5', () => {
    expect(gradeScaleMax('five')).toBe(5)
  })

  it('стобалльная шкала → 100', () => {
    expect(gradeScaleMax('hundred')).toBe(100)
  })

  it('отсутствие шкалы → null', () => {
    expect(gradeScaleMax(null)).toBeNull()
  })
})

describe('isOverdue', () => {
  it('дедлайн в прошлом → просрочено', () => {
    expect(isOverdue('2026-07-25')).toBe(true)
  })

  it('дедлайн сегодня → не просрочено', () => {
    const today = new Date().toLocaleDateString('en-CA')
    expect(isOverdue(today)).toBe(false)
  })

  it('дедлайн в будущем → не просрочено', () => {
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA')
    expect(isOverdue(tomorrow)).toBe(false)
  })

  it('null дедлайн → не просрочено', () => {
    expect(isOverdue(null)).toBe(false)
  })

  it('сравнивает по передаваемой дате', () => {
    expect(isOverdue('2026-07-25', '2026-07-26')).toBe(true)
    expect(isOverdue('2026-07-26', '2026-07-25')).toBe(false)
  })
})

describe('formatDue', () => {
  it('форматирует дату в русском стиле', () => {
    const result = formatDue('2026-07-15')
    expect(result).toBe('до 15 июля')
  })

  it('null дедлайн → null', () => {
    expect(formatDue(null)).toBeNull()
  })

  it('игнорирует время в дате', () => {
    const result1 = formatDue('2026-08-01')
    const result2 = formatDue('2026-08-01T23:59:59Z')
    expect(result1).toBe(result2)
  })
})
