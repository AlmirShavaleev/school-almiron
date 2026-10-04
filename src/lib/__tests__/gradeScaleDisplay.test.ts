import { describe, expect, it } from 'vitest'
import { verdictMark } from '@/lib/studentTodo'
import { courseAverage } from '@/lib/studentHome'
import { fiveOf, toneOf } from '@/lib/courseGrades'
import { formatScore } from '@/lib/courseStats'
import { scoreCaption, scoreTone } from '@/lib/courseAssessments'
import { formatGrade } from '@/lib/studentOverview'

/**
 * §265. Как оценки выглядят на экранах после перехода на шкалы: урок —
 * 0–100 (старые 5-балльные уроки пересчитаны ×20), проверочная и
 * контрольная — оценка 2–5. Старое «принято без балла» и ДЗ без шкалы
 * (до пересчёта) не ломают ни подпись, ни средний.
 */
describe('§265. отображение оценок по шкалам', () => {
  it('главная и «Мои задания»: 5-балльная — «4/5», урок после ×20 — «80/100», без балла — «принято»', () => {
    expect(verdictMark({ score: 4, gradeScale: 'five' })).toBe('4/5')
    expect(verdictMark({ score: 80, gradeScale: 'hundred' })).toBe('80/100')
    expect(verdictMark({ score: null, gradeScale: 'hundred' })).toBe('принято')
    expect(verdictMark({ score: null, gradeScale: null })).toBe('принято')
  })

  it('средний курса: оценки 2–5 — «3,5»; только 100-балльные — «85/100»; принятые без балла в средний не идут', () => {
    expect(courseAverage([
      { status: 'accepted', score: 2, grade_scale: 'five' },
      { status: 'accepted', score: 5, grade_scale: 'five' },
      { status: 'accepted', score: 80, grade_scale: 'hundred' },
    ] as never)).toBe('3,5')
    expect(courseAverage([
      { status: 'accepted', score: 80, grade_scale: 'hundred' },
      { status: 'accepted', score: 90, grade_scale: 'hundred' },
      { status: 'accepted', score: null, grade_scale: 'hundred' },
    ] as never)).toBe('85/100')
    expect(courseAverage([{ status: 'accepted', score: null, grade_scale: null }] as never)).toBe('—')
  })

  it('журнал ДЗ: цвет урока после ×20 тот же, что был у оценки (80 → «4», 100 → «5», 60 → «3», 40 → «2»)', () => {
    expect([100, 80, 60, 40].map(s => toneOf(fiveOf(s, 'hundred')))).toEqual([5, 4, 3, 2])
    expect([5, 4, 3, 2].map(s => toneOf(fiveOf(s, 'five')))).toEqual([5, 4, 3, 2])
  })

  it('статистика, карточка ученика, проверочные: 2–5 — оценкой, 100-балльная — числом', () => {
    expect(formatScore(4.25, 'five')).toBe('4,3')
    expect(formatScore(78.4, 'hundred')).toBe('78')
    expect(formatScore(null, null)).toBe('—')
    expect(formatGrade(4, 'five')).toBe('4,0')
    expect(formatGrade(86, 'hundred')).toBe('86')
    expect(scoreCaption('five')).toBe('оценка')
    expect(scoreCaption('hundred')).toBe('из 100')
    expect(scoreTone(2, 'five')).toBe('bad')
    expect(scoreTone(5, 'five')).toBe('ok')
    expect(scoreTone(40, 'hundred')).toBeUndefined()
  })
})
