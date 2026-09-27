/**
 * §238. Прогон светофора на выгрузке с прода: что было бы, если бы правила
 * стояли тогда. Вход — строки «черновик ИИ + вердикт преподавателя»,
 * выход — числа, по которым решают, держать ли правила:
 *  - сколько строк ушло в зелёные / жёлтые;
 *  - пропуски: правки преподавателя в ЗЕЛЁНЫХ (их со светофором никто не
 *    увидит, пока не раскроет группу);
 *  - пойманные ложные «частично»: предложение светофора совпало с вердиктом
 *    преподавателя, а ИИ сказала другое;
 *  - сколько раз сработала проверка отбора корней и в скольких она права по
 *    вердикту человека.
 * Чистый модуль: его гоняет vitest и `scripts/svetofor-replay.mjs`.
 */

import { classifyRow, type RowTriage, type TriageReason } from './reviewTriage.ts'
import type { AiTaskVerdict } from './aiHomeworkCheck'

export interface ReplayInput {
  ai_verdict: string | null
  student_answer: string | null
  expected_answer: string | null
  note: string | null
  teacher_verdict: string | null
  /** Необязательные метки строки — печатаются в списке пропусков. */
  attempt_id?: string
  no?: string
}

export interface ReplayRow {
  input: ReplayInput
  triage: RowTriage
  changed: boolean
}

export interface ReplayReport {
  total: number
  green: number
  yellow: number
  byReason: Record<TriageReason, number>
  /** Правок преподавателя всего (вердикт человека ≠ вердикт ИИ). */
  changed: number
  /** Правки в зелёных — пропуски светофора. */
  greenChanged: number
  /** Правки в жёлтых — их светофор показал. */
  yellowChanged: number
  /** «Частично» ИИ, где предложение светофора совпало с вердиктом человека и отличалось от ИИ. */
  falsePartialCaught: number
  /** Всего «частично» при совпавшем ответе. */
  partialEqual: number
  /** Сколько из них человек оставил «частично» (предложение «верно» было бы неверным). */
  partialEqualKept: number
  /** Предложение светофора совпало с вердиктом человека (по жёлтым с предложением). */
  suggestionAgreed: number
  suggestionTotal: number
  rootCheck: {
    fired: number
    falseClaim: number
    claimHolds: number
    /** false_claim и человек поправил ИИ, или claim_holds и человек согласился. */
    rightByTeacher: number
  }
  /** Пропуски для ручного разбора. */
  misses: ReplayRow[]
}

const AI_VERDICTS: readonly string[] = ['correct', 'wrong', 'partial', 'unchecked']

export function replayRow(input: ReplayInput): ReplayRow {
  const ai = AI_VERDICTS.includes(String(input.ai_verdict)) ? (input.ai_verdict as AiTaskVerdict) : null
  const triage = classifyRow({
    aiVerdict: ai,
    studentAnswer: input.student_answer,
    expectedAnswer: input.expected_answer,
    note: input.note,
  })
  const teacher = input.teacher_verdict ?? null
  return { input, triage, changed: teacher != null && teacher !== (ai ?? 'unchecked') }
}

export function replay(inputs: readonly ReplayInput[]): ReplayReport {
  const report: ReplayReport = {
    total: 0, green: 0, yellow: 0,
    byReason: { partial_equal: 0, answer_differs: 0, unchecked: 0, correct_other_form: 0, wrong: 0 },
    changed: 0, greenChanged: 0, yellowChanged: 0,
    falsePartialCaught: 0, partialEqual: 0, partialEqualKept: 0,
    suggestionAgreed: 0, suggestionTotal: 0,
    rootCheck: { fired: 0, falseClaim: 0, claimHolds: 0, rightByTeacher: 0 },
    misses: [],
  }
  for (const input of inputs) {
    const row = replayRow(input)
    const { triage, changed } = row
    const teacher = input.teacher_verdict ?? null
    report.total += 1
    if (changed) report.changed += 1
    if (triage.light === 'green') {
      report.green += 1
      if (changed) {
        report.greenChanged += 1
        report.misses.push(row)
      }
    } else {
      report.yellow += 1
      if (triage.reason) report.byReason[triage.reason] += 1
      if (changed) report.yellowChanged += 1
    }
    if (triage.suggested && teacher) {
      report.suggestionTotal += 1
      if (triage.suggested === teacher) report.suggestionAgreed += 1
    }
    if (input.ai_verdict === 'partial' && triage.suggested && triage.suggested !== 'partial' && triage.suggested === teacher) {
      report.falsePartialCaught += 1
    }
    if (triage.reason === 'partial_equal') {
      report.partialEqual += 1
      if (teacher === 'partial') report.partialEqualKept += 1
    }
    if (triage.rootCheck) {
      report.rootCheck.fired += 1
      if (triage.rootCheck.verdict === 'false_claim') {
        report.rootCheck.falseClaim += 1
        if (teacher != null && teacher !== input.ai_verdict) report.rootCheck.rightByTeacher += 1
      } else {
        report.rootCheck.claimHolds += 1
        if (teacher != null && teacher === input.ai_verdict) report.rootCheck.rightByTeacher += 1
      }
    }
  }
  return report
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—')

/** Отчёт словами — то, что печатает скрипт. */
export function formatReplay(r: ReplayReport, options: { showMisses?: boolean } = {}): string {
  const lines = [
    `Строк: ${r.total}`,
    `  зелёных: ${r.green} (${pct(r.green, r.total)}), жёлтых: ${r.yellow} (${pct(r.yellow, r.total)})`,
    `  жёлтые по причинам: частично+совпал ${r.byReason.partial_equal}, частично+другой ${r.byReason.answer_differs}, неверно ${r.byReason.wrong}, не сверено ${r.byReason.unchecked}, верно+иначе ${r.byReason.correct_other_form}`,
    `Правок преподавателя: ${r.changed}`,
    `  в жёлтых (светофор показал): ${r.yellowChanged}`,
    `  в зелёных (ПРОПУСКИ): ${r.greenChanged} из ${r.green} зелёных (${pct(r.greenChanged, r.green)})`,
    `Ложные «частично» пойманы (предложение = вердикт человека): ${r.falsePartialCaught}`,
    `  «частично» при совпавшем ответе: ${r.partialEqual}, из них человек оставил «частично»: ${r.partialEqualKept}`,
    `Предложение светофора совпало с человеком: ${r.suggestionAgreed} из ${r.suggestionTotal} (${pct(r.suggestionAgreed, r.suggestionTotal)})`,
    `Проверка отбора корней: сработала ${r.rootCheck.fired} (ложных претензий ${r.rootCheck.falseClaim}, верных ${r.rootCheck.claimHolds}); права по вердикту человека: ${r.rootCheck.rightByTeacher} из ${r.rootCheck.fired}`,
  ]
  if (options.showMisses && r.misses.length > 0) {
    lines.push('Пропуски (зелёные, которые человек изменил):')
    for (const m of r.misses) {
      const i = m.input
      lines.push(`  ${i.attempt_id ?? '?'} №${i.no ?? '?'}: ИИ ${i.ai_verdict} → ${i.teacher_verdict}; ответ «${i.student_answer ?? ''}» / эталон «${i.expected_answer ?? ''}»`)
    }
  }
  return lines.join('\n')
}
