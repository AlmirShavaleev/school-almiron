import { describe, expect, it } from 'vitest'
import {
  formatSpan, liveCounts, liveCountsLine, liveHeadline, livePhase, liveRows, sheetLabel, shouldPoll,
  type LiveStudentRow,
} from '@/lib/mockExamLive'

/**
 * §224. Монитор идущего пробника: вывод словами, счётчики с числом группы,
 * порядок учеников. «Онлайн» решает база — здесь только раскладка.
 */

// 18.10.2026: 10:00–14:00 по Москве, фото до 14:15.
const W = { starts_at: '2026-10-18T07:00:00.000Z', ends_at: '2026-10-18T11:00:00.000Z', photos_until: '2026-10-18T11:15:00.000Z' }
const at = (iso: string) => new Date(iso).getTime()

const st = (name: string, extra: Partial<LiveStudentRow> = {}): LiveStudentRow => ({
  student_id: name, name, has_sheet: false, opened_at: null, last_seen_at: null, online: false,
  answered: null, submitted_at: null, photos: 0, ...extra,
})

describe('строка-вывод', () => {
  it('идёт: сколько осталось и до скольки — по Москве', () => {
    expect(livePhase(W, at('2026-10-18T08:47:00Z'))).toBe('running')
    expect(liveHeadline(W, at('2026-10-18T08:47:00Z'))).toBe('Идёт · осталось 2 ч 13 мин · до 14:00')
  })
  it('после конца — 15 минут догрузки фото, потом просто «закончился»', () => {
    expect(liveHeadline(W, at('2026-10-18T11:05:00Z'))).toBe('Закончился в 14:00 · фото до 14:15')
    expect(livePhase(W, at('2026-10-18T11:20:00Z'))).toBe('ended')
    expect(liveHeadline(W, at('2026-10-18T11:20:00Z'))).toBe('Закончился · 18 октября, 10:00–14:00')
  })
  it('до начала — когда и через сколько', () => {
    expect(liveHeadline(W, at('2026-10-18T06:15:00Z'))).toBe('Начнётся 18 октября в 10:00 · через 45 мин')
  })
  it('formatSpan: ровные часы без «0 мин», последние секунды — «1 мин», а не «0»', () => {
    expect(formatSpan(2 * 3600_000)).toBe('2 ч')
    expect(formatSpan(20_000)).toBe('1 мин')
  })
})

describe('опрос — только пока окно не закрыто + 15 минут', () => {
  it('до конца догрузки фото — да, после — нет', () => {
    expect(shouldPoll(W, at('2026-10-18T06:00:00Z'))).toBe(true)
    expect(shouldPoll(W, at('2026-10-18T11:14:59Z'))).toBe(true)
    expect(shouldPoll(W, at('2026-10-18T11:15:00Z'))).toBe(false)
  })
})

describe('ученики: порядок, метки, счётчики', () => {
  const students = [
    st('Яковлев', { has_sheet: true, submitted_at: '2026-10-18T10:20:00Z', online: true, answered: 12, photos: 3 }),
    st('Белов', { has_sheet: true, online: true, answered: 8 }),
    st('Абрамова', { has_sheet: true, online: true, answered: 5 }),
    st('Ёлкина', { has_sheet: true, online: false, last_seen_at: '2026-10-18T09:41:00Z', answered: 2 }),
    st('Сафин'),
    st('Ахмедов'),
  ]

  it('идёт: не заходили → были и ушли → пишут → сдали; внутри — по алфавиту', () => {
    const rows = liveRows(students, 'running')
    expect(rows.map(r => [r.name, r.label, r.tone])).toEqual([
      ['Ахмедов', 'Не заходил', 'problem'],
      ['Сафин', 'Не заходил', 'problem'],
      ['Ёлкина', 'Был в 12:41', 'warn'],
      ['Абрамова', 'Пишет · онлайн', 'live'],
      ['Белов', 'Пишет · онлайн', 'live'],
      ['Яковлев', 'Сдал в 13:20', 'ok'],
    ])
  })

  it('сдавший и ещё открытый — «сдал», а не «пишет»', () => {
    expect(liveRows([students[0]], 'running')[0].kind).toBe('submitted')
  })

  it('одна строка счётчиков словами, с числом группы', () => {
    const c = liveCounts(liveRows(students, 'running'))
    expect(liveCountsLine(c, 'running')).toBe('В группе 6 · пишут сейчас 2 · сдали 1 · открывали, сейчас не на сайте 1 · не заходили 2')
  })

  it('после конца «пишут» не бывает: открывал и не сдал — одной цифрой', () => {
    const c = liveCounts(liveRows(students, 'photos'))
    expect(liveCountsLine(c, 'photos')).toBe('В группе 6 · сдали 1 · открывали, не нажали «Сдать» 3 · не заходили 2')
    expect(liveRows([students[3]], 'photos')[0].label).toBe('Был в 12:41 · не сдал')
  })

  it('до начала «не заходил» — не проблема, метка спокойная', () => {
    const r = liveRows([st('Сафин')], 'upcoming')[0]
    expect(r.tone).toBe('idle')
    expect(liveCountsLine(liveCounts([r]), 'upcoming')).toBe('В группе 1')
  })

  it('бланк «8 из 12»; неизвестно — пусто', () => {
    expect(sheetLabel(8, 12)).toBe('бланк 8 из 12')
    expect(sheetLabel(null, 12)).toBe('')
  })
})
