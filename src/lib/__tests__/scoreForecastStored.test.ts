import { describe, expect, it } from 'vitest'
import { normalizeForecastResponse } from '@/lib/egeForecast'
import { forecastSummary } from '@/lib/studentOverview'
import { storedSummaryForecast, summaryForecast } from '@/lib/courseSummary'
import { forecastNote, normalizeStoredForecasts } from '@/lib/scoreForecast'
import { storedForecastsFromEvidence } from '../../../supabase/functions/_shared/scoreForecast.ts'

/**
 * Прогноз балла — считать ночью и хранить (письмо ЛК_прогноз_балла_хранить.md, 16.10).
 * «Браузерный расчёт = расчёт в функции»: на пяти учениках-фикстурах то, что
 * экран считал в браузере из свидетельств (`forecastSummary`, `summaryForecast`),
 * совпадает с тем, что он покажет из хранимой строки `forecast-daily`
 * (`storedForecastsFromEvidence` → JSON → `normalizeStoredForecasts`).
 */

const NOW = '2026-10-16T09:00:00Z'
const day = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()

type Ev = { subject: string; ns: number[]; source: 'hw' | 'test' | 'mock' | 'catalog'; score: number; at: string; item: string }
function ev(subject: string, spec: Array<[n: number, right: number, wrong: number, ageDays: number, source?: Ev['source']]>): Ev[] {
  const out: Ev[] = []
  for (const [n, right, wrong, age, source = 'catalog'] of spec) {
    for (let i = 0; i < right + wrong; i++) {
      out.push({ subject, ns: [n], source, score: i < right ? 1 : 0, at: day(age + i * 0.1), item: `${subject}:${n}:${age}:${i}` })
    }
  }
  return out
}

// Ответы student_forecast_evidence_of — то, что видит и браузер, и функция.
const STUDENTS: Record<string, { subjects: string[]; evidence: Ev[] }> = {
  // сильный физик: решает почти всю первую часть, свежие решения и пробник
  strong: { subjects: ['physics'], evidence: [
    ...ev('physics', Array.from({ length: 18 }, (_, i) => [i + 1, 5, 1, 3] as [number, number, number, number])),
    ...ev('physics', [[20, 1, 1, 10, 'mock'], [21, 1, 0, 10, 'mock']]),
  ] },
  // мало данных: три номера — прогноза ещё нет («few»)
  few: { subjects: ['physics'], evidence: ev('physics', [[1, 2, 0, 1], [2, 1, 1, 2], [3, 0, 2, 3]]) },
  // рост за месяц: старые неверные, свежие верные
  growing: { subjects: ['physics'], evidence: [
    ...ev('physics', Array.from({ length: 12 }, (_, i) => [i + 1, 0, 3, 40] as [number, number, number, number])),
    ...ev('physics', Array.from({ length: 12 }, (_, i) => [i + 1, 4, 0, 2] as [number, number, number, number])),
  ] },
  // математика профиль, ДЗ темами
  math: { subjects: ['math'], evidence: ev('math', Array.from({ length: 12 }, (_, i) => [i + 1, 2, 2, 5, 'hw'] as [number, number, number, number, Ev['source']])) },
  // два предмета сразу
  both: { subjects: ['physics', 'math'], evidence: [
    ...ev('physics', Array.from({ length: 14 }, (_, i) => [i + 1, 3, 1, 6] as [number, number, number, number])),
    ...ev('math', Array.from({ length: 8 }, (_, i) => [i + 1, 1, 2, 8] as [number, number, number, number])),
  ] },
}

function rawOf(s: { subjects: string[]; evidence: Ev[] }) {
  return { now: NOW, subjects: s.subjects.map(subject => ({ subject, goal: null, teacher_goal: null })), titles: [], numbers: [], evidence: s.evidence }
}

describe('хранимый прогноз = браузерный расчёт', () => {
  for (const [name, s] of Object.entries(STUDENTS)) {
    it(`ученик «${name}»: карточка и сводка класса — те же цифры`, () => {
      const raw = rawOf(s)
      // Что пишет forecast-daily — через JSON, как в базу и обратно.
      const rows = JSON.parse(JSON.stringify(storedForecastsFromEvidence(raw).map(r => ({ ...r, computed_at: NOW }))))
      const stored = normalizeStoredForecasts(rows)
      expect(stored.map(r => r.subject).sort()).toEqual([...s.subjects].sort())
      const browser = normalizeForecastResponse(raw)
      for (const subject of s.subjects) {
        const row = stored.find(r => r.subject === subject)!
        expect(forecastSummary(null, subject, null, row)).toEqual(forecastSummary(browser, subject))
        expect(storedSummaryForecast(row)).toEqual(summaryForecast(browser, subject))
      }
    })
  }

  it('фикстуры покрывают оба случая: балл есть и «мало данных»', () => {
    const kinds = Object.values(STUDENTS).flatMap(s => s.subjects.map(sub => forecastSummary(normalizeForecastResponse(rawOf(s)), sub).kind))
    expect(kinds).toContain('ready')
    expect(kinds).toContain('few')
  })

  it('строка компактная: details < 2 КБ, основание словами', () => {
    const [row] = storedForecastsFromEvidence(rawOf(STUDENTS.strong))
    expect(JSON.stringify(row.details).length).toBeLessThan(2048)
    expect(row.basis).toBe('по 108 задачам и 3 пробникам') // 18 номеров × 6 задач; 3 задания пробников
  })

  it('подпись у цели: «прогноз N», «мало данных», «появится завтра»; без функции — ничего', () => {
    const rows = normalizeStoredForecasts(storedForecastsFromEvidence(rawOf(STUDENTS.both)).map(r => ({ ...r, computed_at: NOW })))
    expect(forecastNote(rows, 'physics')).toMatch(/^прогноз \d+$/)
    expect(forecastNote(normalizeStoredForecasts(storedForecastsFromEvidence(rawOf(STUDENTS.few))), 'physics')).toBe('прогноз: мало данных')
    expect(forecastNote([], 'physics')).toBe('прогноз появится завтра')
    expect(forecastNote(null, 'physics')).toBeNull()
  })
})
