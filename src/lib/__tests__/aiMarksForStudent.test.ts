import { describe, expect, it } from 'vitest'
import {
  aiMarkDropLabel, aiMarksToggleLabel, hasEligibleAiMarks, planAiMarksForStudent, verdictSendsAiMarks,
  verdictToastText,
} from '@/lib/aiMarksForStudent'
import type { ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'

const finding = (id: string, task: string | null, text = `Находка ${id}`, position = 0) => ({ id, task, text, position })
const task = (no: string, verdict: ReviewTaskVerdict) => ({ no, verdict })
const ids = (items: { finding: { id: string } }[]) => items.map(item => item.finding.id)

describe('§252 — какие находки ИИ уходят ученику при вердикте', () => {
  it('уходят по «неверно», «частично» и «не решено»; по «верно» и «не сверено» — нет', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('w', '1'), finding('p', '2'), finding('u', '3'), finding('c', '4'), finding('n', '5')],
      tasks: [task('1', 'wrong'), task('2', 'partial'), task('3', 'unsolved'), task('4', 'correct'), task('5', 'unchecked')],
    })
    expect(ids(plan.chosen)).toEqual(['w', 'p', 'u'])
    expect(plan.dropped.map(item => [item.finding.id, item.reason])).toEqual([['c', 'correct'], ['n', 'unchecked']])
    expect(aiMarkDropLabel(plan.dropped[0])).toBe('Не уйдёт: вы отметили «верно»')
    expect(verdictSendsAiMarks('unsolved')).toBe(true)
    expect(verdictSendsAiMarks('unchecked')).toBe(false)
  })

  it('вердикт — из таблицы учителя, а не номер «как у ИИ»: «№ 4» и «4» — одно задание', () => {
    const plan = planAiMarksForStudent({ findings: [finding('a', '№ 4')], tasks: [task('4', 'wrong')] })
    expect(plan.chosen).toEqual([{ finding: expect.objectContaining({ id: 'a' }), taskNo: '4' }])
  })

  it('номер задания из текста, если столбца нет (находки до §192)', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('a', null, 'В задаче 12 потерян знак')],
      tasks: [task('12', 'partial')],
    })
    expect(ids(plan.chosen)).toEqual(['a'])
  })

  it('без номера задания и с номером, которого нет в таблице, — не уходят (вердикта нет)', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('none', null, 'Неаккуратно'), finding('x', '9')],
      tasks: [task('1', 'wrong')],
    })
    expect(plan.chosen).toEqual([])
    expect(plan.dropped.map(item => item.reason)).toEqual(['no-task', 'unknown-task'])
    expect(aiMarkDropLabel(plan.dropped[1])).toBe('Не уйдёт: задания №9 нет в таблице')
  })

  it('уже взятые («взять») и отклонённые («мимо») в план не попадают вовсе', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('taken', '1'), finding('skip', '1'), finding('new', '1')],
      tasks: [task('1', 'wrong')],
      takenNotes: [{ findingId: 'taken', taskNo: '1' }, { findingId: null, taskNo: '1' }],
      dismissedFindingIds: ['skip'],
    })
    expect(ids(plan.chosen)).toEqual(['new'])
    expect(plan.dropped).toEqual([])
  })

  it('«Проверить заново»: по заданию уже лежит пометка из прошлой проверки — новая находка не уходит', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('job2-4', '4'), finding('job2-5', '5')],
      tasks: [task('4', 'wrong'), task('5', 'wrong')],
      // job1-4 среди текущих находок нет — это прошлый прогон, тот же разбор другим id.
      takenNotes: [{ findingId: 'job1-4', taskNo: '4' }],
    })
    expect(ids(plan.chosen)).toEqual(['job2-5'])
    expect(plan.dropped).toEqual([expect.objectContaining({ reason: 'already-marked', taskNo: '4' })])
  })

  it('убранная крестиком не уходит, но остаётся в списке на своём месте — её можно вернуть', () => {
    const findings = [finding('a', '4'), finding('b', '5'), finding('c', '12')]
    const tasks = [task('4', 'wrong'), task('5', 'wrong'), task('12', 'partial')]
    const plan = planAiMarksForStudent({ findings, tasks, removedIds: ['b'] })
    expect(ids(plan.chosen)).toEqual(['a', 'c'])
    expect(ids(plan.removed)).toEqual(['b'])
    expect(plan.eligible.map(item => [item.finding.id, item.removed])).toEqual([['a', false], ['b', true], ['c', false]])
    expect(aiMarksToggleLabel(plan.chosen)).toBe('Показать ученику 2 пометки ИИ (№4, №12)')
    // Вернули — снова уходит.
    expect(ids(planAiMarksForStudent({ findings, tasks, removedIds: [] }).chosen)).toEqual(['a', 'b', 'c'])
  })

  it('пересчёт при смене вердикта: «верно» → «неверно» добавляет находку', () => {
    const findings = [finding('a', '4'), finding('b', '10')]
    const before = planAiMarksForStudent({ findings, tasks: [task('4', 'wrong'), task('10', 'correct')] })
    const after = planAiMarksForStudent({ findings, tasks: [task('4', 'wrong'), task('10', 'wrong')] })
    expect(ids(before.chosen)).toEqual(['a'])
    expect(ids(after.chosen)).toEqual(['a', 'b'])
  })

  it('порядок — по номеру задания по-человечески («2» перед «10»), внутри — как пришли', () => {
    const plan = planAiMarksForStudent({
      findings: [finding('ten', '10', 't', 0), finding('two-b', '2', 'b', 2), finding('two-a', '2', 'a', 1)],
      tasks: [task('2', 'wrong'), task('10', 'wrong')],
    })
    expect(ids(plan.chosen)).toEqual(['two-a', 'two-b', 'ten'])
    expect(aiMarksToggleLabel(plan.chosen)).toBe('Показать ученику 3 пометки ИИ (№2, №10)')
  })

  it('пустой текст находки — не пометка, в план не идёт', () => {
    const plan = planAiMarksForStudent({ findings: [finding('a', '1', '   ')], tasks: [task('1', 'wrong')] })
    expect(hasEligibleAiMarks(plan)).toBe(false)
  })

  it('подписи: склонение и номера с многоточием', () => {
    const one = planAiMarksForStudent({ findings: [finding('a', '1')], tasks: [task('1', 'wrong')] })
    expect(aiMarksToggleLabel(one.chosen)).toBe('Показать ученику 1 пометку ИИ (№1)')
    const many = planAiMarksForStudent({
      findings: Array.from({ length: 8 }, (_v, i) => finding(`f${i}`, String(i + 1))),
      tasks: Array.from({ length: 8 }, (_v, i) => task(String(i + 1), 'wrong')),
    })
    expect(aiMarksToggleLabel(many.chosen)).toBe('Показать ученику 8 пометок ИИ (№1, №2, №3, №4, №5, №6…)')
    expect(aiMarksToggleLabel([])).toBe('Показать ученику 0 пометок ИИ')
  })

  it('тост после вердикта', () => {
    expect(verdictToastText('accepted', 4, 5)).toBe('Принято · 4. Ученику ушла работа, пометок на фото: 5')
    expect(verdictToastText('accepted', null, 0)).toBe('Принято. Ученику ушла работа, пометок на фото: 0')
    expect(verdictToastText('returned_for_revision', null, 2)).toBe('Возвращено на доработку. Ученику ушла работа, пометок на фото: 2')
  })
})
