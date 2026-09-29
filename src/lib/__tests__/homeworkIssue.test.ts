/**
 * §243. Статус выдачи ДЗ для учителя — зеркало серверного правила
 * `_topic_homework_autopublish` (PENDING_243): тема открыта (`topic_open_now`)
 * и есть файл задания либо это работа по времени; каркас не выдаётся.
 */
import { describe, expect, it } from 'vitest'
import { describeDigestEta, homeworkIssueStatus } from '@/lib/homeworkIssue'

const TODAY = '2026-10-05'
const open = { is_open: true, available_from: null }

describe('homeworkIssueStatus', () => {
  it('открыта и есть файл — выдано', () => {
    expect(homeworkIssueStatus({ topic: open, fileCount: 1, timed: false, today: TODAY }))
      .toEqual({ state: 'issued', label: 'Выдано · тема открыта', note: null })
  })

  it('по дате: дата наступила — выдано, впереди — не выдано и «откроется …»', () => {
    expect(homeworkIssueStatus({ topic: { is_open: null, available_from: '2026-10-05' }, fileCount: 1, timed: false, today: TODAY }).state).toBe('issued')
    expect(homeworkIssueStatus({ topic: { is_open: null, available_from: '2026-10-06' }, fileCount: 1, timed: false, today: TODAY }))
      .toEqual({ state: 'closed', label: 'Не выдано · тема закрыта', note: 'откроется 6 октября' })
  })

  it('закрыта тумблером — дата не действует, «откроется» не обещаем', () => {
    expect(homeworkIssueStatus({ topic: { is_open: false, available_from: '2026-10-06' }, fileCount: 1, timed: false, today: TODAY }))
      .toEqual({ state: 'closed', label: 'Не выдано · тема закрыта', note: null })
  })

  it('открыта без файлов: урок — «Нет файлов задания», работа по времени — выдано', () => {
    expect(homeworkIssueStatus({ topic: open, fileCount: 0, timed: false, today: TODAY }).state).toBe('no_files')
    expect(homeworkIssueStatus({ topic: open, fileCount: 0, timed: true, today: TODAY }).state).toBe('issued')
  })

  it('каркас — не выдаётся, при любой открытости', () => {
    expect(homeworkIssueStatus({ topic: open, fileCount: 3, timed: false, isTemplate: true, today: TODAY }).state).toBe('template')
  })
})

describe('describeDigestEta', () => {
  const NOW = new Date('2026-10-05T10:00:00.000Z') // 13:00 МСК

  it('сегодня — «уйдёт в 14:55» по Москве', () => {
    expect(describeDigestEta('2026-10-05T11:55:00.000Z', NOW)).toBe('Сводка ученикам уйдёт в 14:55')
  })
  it('завтра — «уйдёт завтра в 08:00»', () => {
    expect(describeDigestEta('2026-10-06T05:00:00.000Z', NOW)).toBe('Сводка ученикам уйдёт завтра в 08:00')
  })
  it('срок уже прошёл (крон раз в 5 минут) — «в ближайшие минуты»; пусто — null', () => {
    expect(describeDigestEta('2026-10-05T09:58:00.000Z', NOW)).toBe('Сводка ученикам уйдёт в ближайшие минуты')
    expect(describeDigestEta(null, NOW)).toBeNull()
    expect(describeDigestEta('не дата', NOW)).toBeNull()
  })
})
