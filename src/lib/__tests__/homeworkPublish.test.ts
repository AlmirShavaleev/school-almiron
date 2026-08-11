import { describe, expect, it } from 'vitest'
import {
  planHomeworkPublish, describePublishResult, describeSkipReason,
  type PublishableHomework,
} from '@/lib/homeworkPublish'

const topic = (id: string, title = id) => ({ id, title })
const hw = (id: string, topicId: string, published = false): PublishableHomework =>
  ({ id, topic_id: topicId, is_published: published })

describe('planHomeworkPublish', () => {
  it('публикует то, у чего есть файлы и что ещё не опубликовано', () => {
    const plan = planHomeworkPublish([topic('t1')], [hw('h1', 't1')], { h1: 2 })

    expect(plan.publishIds).toEqual(['h1'])
    expect(plan.skipped).toEqual([])
  })

  /** Повторная выдача ничего не меняет — и не должна попадать в счёт. */
  it('уже опубликованное пропускает с причиной', () => {
    const plan = planHomeworkPublish([topic('t1', 'Кинематика')], [hw('h1', 't1', true)], { h1: 2 })

    expect(plan.publishIds).toEqual([])
    expect(plan.skipped).toEqual([{ topicTitle: 'Кинематика', reason: 'already' }])
  })

  /**
   * Массовое действие не имеет права быть добрее одиночного: в модалке темы
   * кнопка публикации заблокирована, пока к ДЗ не прикреплён хотя бы файл.
   */
  it('ДЗ без файлов не публикуется', () => {
    const plan = planHomeworkPublish([topic('t1', 'Динамика')], [hw('h1', 't1')], { h1: 0 })

    expect(plan.publishIds).toEqual([])
    expect(plan.skipped).toEqual([{ topicTitle: 'Динамика', reason: 'no_files' }])
  })

  it('неизвестное число файлов считается нулём — ошибаемся в сторону «не публиковать»', () => {
    const plan = planHomeworkPublish([topic('t1')], [hw('h1', 't1')], {})

    expect(plan.publishIds).toEqual([])
    expect(plan.skipped[0].reason).toBe('no_files')
  })

  it('тема без ДЗ попадает в пропуски, а не теряется молча', () => {
    const plan = planHomeworkPublish([topic('t1', 'Пустая тема')], [], {})

    expect(plan.skipped).toEqual([{ topicTitle: 'Пустая тема', reason: 'no_homework' }])
  })

  it('смесь тем разбирается по каждой отдельно', () => {
    const plan = planHomeworkPublish(
      [topic('t1', 'Готова'), topic('t2', 'Уже'), topic('t3', 'Пустая'), topic('t4', 'Без файлов')],
      [hw('h1', 't1'), hw('h2', 't2', true), hw('h4', 't4')],
      { h1: 1, h2: 1, h4: 0 },
    )

    expect(plan.publishIds).toEqual(['h1'])
    expect(plan.skipped.map(s => s.reason).sort()).toEqual(['already', 'no_files', 'no_homework'])
  })

  it('чужие ДЗ в списке не публикуются заодно', () => {
    // В выборку могли попасть ДЗ соседнего модуля — берём только свои темы.
    const plan = planHomeworkPublish([topic('t1')], [hw('h1', 't1'), hw('h9', 'чужая')], { h1: 1, h9: 1 })

    expect(plan.publishIds).toEqual(['h1'])
  })
})

describe('describePublishResult', () => {
  it('честный итог с разбивкой по причинам', () => {
    const text = describePublishResult(3, [
      { topicTitle: 'a', reason: 'already' },
      { topicTitle: 'b', reason: 'already' },
      { topicTitle: 'c', reason: 'no_files' },
    ])

    expect(text).toBe('Опубликовано ДЗ: 3. Пропущено 3: уже опубликовано — 2, нет файлов задания — 1')
  })

  it('без пропусков — короткая фраза', () => {
    expect(describePublishResult(2, [])).toBe('Опубликовано ДЗ: 2')
  })

  /** Ноль опубликованных — не «успех на 0», а прямое «нечего было». */
  it('ноль опубликованных говорит об этом прямо', () => {
    expect(describePublishResult(0, [{ topicTitle: 'a', reason: 'already' }]))
      .toBe('Публиковать было нечего. Пропущено 1: уже опубликовано — 1')
  })

  it('у каждой причины есть человеческая подпись', () => {
    expect(describeSkipReason('already')).toBe('уже опубликовано')
    expect(describeSkipReason('no_files')).toBe('нет файлов задания')
    expect(describeSkipReason('no_homework')).toBe('ДЗ не создано')
  })
})
