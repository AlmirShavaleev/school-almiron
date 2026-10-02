/**
 * §259. Срок ДЗ у учителя: первая сдача по Москве против даты срока
 * (включительно), то же правило, что «ДЗ вовремя» в наградах (§255/§257).
 */
import { describe, expect, it } from 'vitest'
import {
  deadlineLabel, deadlineSummary, deadlineSummaryText, deadlineTone, firstSubmittedAt, formatDueDate, homeworkDeadline,
} from '@/lib/homeworkDeadline'

const DUE = '2026-09-11'
/** 2 октября 2026, 12:30 МСК. */
const NOW = Date.parse('2026-10-02T09:30:00Z')
const sub = (iso: string | null) => ({ submitted_at: iso })

describe('homeworkDeadline — первая сдача против срока', () => {
  it('день срока 23:59 МСК — вовремя (срок включительно)', () => {
    const s = homeworkDeadline(DUE, [sub('2026-09-11T20:59:00Z')], NOW)
    expect(s).toEqual({ kind: 'ontime', submittedAt: '2026-09-11T20:59:00Z' })
    expect(deadlineLabel(s)).toBe('вовремя')
  })

  it('сдал 11 сент в 23:40 при сроке «до 11 сент» — вовремя', () => {
    expect(homeworkDeadline(DUE, [sub('2026-09-11T20:40:00Z')], NOW).kind).toBe('ontime')
  })

  it('00:00 МСК следующего дня — опоздание 1 дн. (хотя по UTC это ещё 11-е)', () => {
    const s = homeworkDeadline(DUE, [sub('2026-09-11T21:00:00Z')], NOW)
    expect(s).toEqual({ kind: 'late', days: 1, submittedAt: '2026-09-11T21:00:00Z' })
    expect(deadlineLabel(s)).toBe('опоздание 1 дн.')
  })

  it('опоздание — дни между датой срока и датой сдачи по Москве', () => {
    expect(deadlineLabel(homeworkDeadline(DUE, [sub('2026-09-28T16:23:00Z')], NOW))).toBe('опоздание 17 дн.')
  })

  it('пересдача после доработки опоздания не делает: считается первая сдача', () => {
    const attempts = [
      sub('2026-09-28T16:00:00Z'), // вторая попытка, после доработки — позже срока
      sub('2026-09-06T07:52:00Z'), // первая — до срока
    ]
    expect(firstSubmittedAt(attempts)).toBe('2026-09-06T07:52:00Z')
    expect(homeworkDeadline(DUE, attempts, NOW).kind).toBe('ontime')
  })

  it('и наоборот: первая сдача поздно — поздняя, даже если потом сдал ещё', () => {
    const s = homeworkDeadline(DUE, [sub('2026-09-13T10:00:00Z'), sub('2026-09-20T10:00:00Z')], NOW)
    expect(s).toMatchObject({ kind: 'late', days: 2 })
  })

  it('только черновик (submitted_at пуст) — не сдано: срок прошёл — «просрочено N дн.»', () => {
    const s = homeworkDeadline(DUE, [sub(null)], NOW)
    expect(s).toEqual({ kind: 'overdue', days: 21 })
    expect(deadlineLabel(s)).toBe('просрочено 21 дн.')
    expect(homeworkDeadline(DUE, [], NOW)).toEqual({ kind: 'overdue', days: 21 })
  })

  it('не сдано, срок не наступил — «ещё N дн.»; в день срока — «сегодня срок»', () => {
    expect(deadlineLabel(homeworkDeadline('2026-10-05', [], NOW))).toBe('ещё 3 дн.')
    expect(deadlineLabel(homeworkDeadline('2026-10-02', [sub(null)], NOW))).toBe('сегодня срок')
    // 2 октября 23:59 МСК — ещё «сегодня»; 3 октября 00:00 МСК — уже просрочено на 1 день.
    expect(homeworkDeadline('2026-10-02', [], Date.parse('2026-10-02T20:59:00Z')).kind).toBe('today')
    expect(homeworkDeadline('2026-10-02', [], Date.parse('2026-10-02T21:00:00Z'))).toEqual({ kind: 'overdue', days: 1 })
  })

  it('срок не задан — статуса нет, «—»', () => {
    const s = homeworkDeadline(null, [sub('2026-09-11T20:40:00Z')], NOW)
    expect(s).toEqual({ kind: 'none' })
    expect(deadlineLabel(s)).toBe('—')
    expect(deadlineTone(s)).toBe('none')
  })

  it('срок в виде timestamp тоже понимается по дате', () => {
    expect(homeworkDeadline('2026-09-11T00:00:00+00:00', [sub('2026-09-11T20:40:00Z')], NOW).kind).toBe('ontime')
  })
})

describe('тон, сводка и дата', () => {
  it('тон: вовремя — зелёный, опоздание — янтарный, просрочено — красный, ещё/сегодня — серый', () => {
    expect(deadlineTone({ kind: 'ontime', submittedAt: 'x' })).toBe('ok')
    expect(deadlineTone({ kind: 'late', days: 1, submittedAt: 'x' })).toBe('late')
    expect(deadlineTone({ kind: 'overdue', days: 1 })).toBe('bad')
    expect(deadlineTone({ kind: 'left', days: 1 })).toBe('wait')
    expect(deadlineTone({ kind: 'today' })).toBe('wait')
  })

  it('сводка: вовремя / с опозданием / не сдали (и просроченные, и с запасом)', () => {
    const states = [
      homeworkDeadline(DUE, [sub('2026-09-06T07:52:00Z')], NOW),
      homeworkDeadline(DUE, [sub('2026-09-11T20:40:00Z')], NOW),
      homeworkDeadline(DUE, [sub('2026-09-28T16:23:00Z')], NOW),
      homeworkDeadline(DUE, [], NOW),
      homeworkDeadline(DUE, [sub(null)], NOW),
    ]
    const s = deadlineSummary(states)
    expect(s).toEqual({ ontime: 2, late: 1, missing: 2 })
    expect(deadlineSummaryText(s!)).toBe('вовремя 2 · с опозданием 1 · не сдали 2')
  })

  it('без срока — сводки нет', () => {
    expect(deadlineSummary([{ kind: 'none' }, { kind: 'none' }])).toBeNull()
    expect(deadlineSummary([])).toBeNull()
  })

  it('дата срока — «пт 11 сент» (день недели — настоящий, 11.09.2026 — пятница)', () => {
    expect(formatDueDate(DUE)).toBe('пт 11 сент')
    expect(formatDueDate('2026-10-03')).toBe('сб 3 окт')
    expect(formatDueDate(null)).toBeNull()
  })
})
