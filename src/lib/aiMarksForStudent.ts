/**
 * §252. Какие находки ИИ уходят ученику вместе с вердиктом.
 *
 * Зачем. За 30 дней пометки на фото увидели ученики только в 47 % проверенных
 * работ: находка ИИ становится пометкой лишь по «взять» (§209), а на деле
 * учитель ставит вердикты по заданиям и жмёт «Принять». Владелец (01.10):
 * галочка «Показать ученику N пометок ИИ» включена сразу, и с ней вердикт
 * переносит находки — но только по заданиям, где учитель САМ поставил
 * «неверно» или «частично». Граница §209 не сдвигается: рамку ИИ в
 * `annotation_sets` переносит действие учителя, здесь это вердикт с галочкой.
 *
 * Модуль чистый: ни DOM, ни сети. Решает только «что уйдёт» — переносит
 * аннотатор тем же путём, что «взять» (`SubmissionReviewer.addFindingRegions`).
 *
 * Правило:
 *  - вердикт задания берётся из таблицы проверки (`topic_homework_review_tasks`)
 *    в момент вердикта: «неверно», «частично» и «не решено» (как «неверно») —
 *    уходят; «верно» и «не сверено» — нет;
 *  - уже взятые («взять») и отклонённые («мимо») находки в план не попадают
 *    вовсе: взятая уже стала пометкой учителя и уйдёт как она, отклонённую
 *    учитель отверг;
 *  - по заданию уже лежит пометка, взятая из ПРОШЛОЙ проверки ИИ («Проверить
 *    заново» дала новые id на те же места) — новая находка не уходит, иначе
 *    ученик получит две рамки на одну ошибку;
 *  - без номера задания или с номером, которого нет в таблице, — не уходит:
 *    вердикта по ней нет, а правило владельца держится именно на вердикте.
 *    Такую находку учитель по-прежнему может «взять» руками в полной таблице;
 *  - убранная крестиком — не уходит, но остаётся в списке, чтобы её можно
 *    было вернуть.
 */

import { normalizeTaskNo, taskNoOfFinding, type AiFindingRow } from './aiHomeworkCheck'
import { compareTaskNo, type ReviewTaskVerdict } from './homeworkReviewTasks'
import { plural } from './plural'

/** Почему подходящая по виду находка ученику не уйдёт. */
export type AiMarkDropReason = 'correct' | 'unchecked' | 'no-task' | 'unknown-task' | 'already-marked'

/** Вердикты, по которым находки уходят. «Не решено» владелец велел считать как «неверно». */
const SENDING_VERDICTS: ReadonlySet<ReviewTaskVerdict> = new Set<ReviewTaskVerdict>(['wrong', 'partial', 'unsolved'])

export function verdictSendsAiMarks(verdict: ReviewTaskVerdict | null | undefined): boolean {
  return verdict != null && SENDING_VERDICTS.has(verdict)
}

/** Находка с тем, что о ней известно правилу. */
export interface AiMarkItem<F> {
  finding: F
  /** Номер задания так, как его пишет таблица («4»), или null — номера нет. */
  taskNo: string | null
}

export interface AiMarkDropped<F> extends AiMarkItem<F> {
  reason: AiMarkDropReason
}

export interface AiMarksPlan<F> {
  /** Уйдут ученику при вердикте с галочкой. */
  chosen: AiMarkItem<F>[]
  /** Подходят по правилу, но учитель убрал их крестиком. */
  removed: AiMarkItem<F>[]
  /** Все подходящие по порядку — для списка, где убранная стоит на своём месте. */
  eligible: (AiMarkItem<F> & { removed: boolean })[]
  /** Не уйдут по правилу — показываются серым с причиной. */
  dropped: AiMarkDropped<F>[]
}

export interface AiMarksInput<F extends Pick<AiFindingRow, 'id' | 'text' | 'position'> & { task?: string | null }> {
  findings: readonly F[]
  /** Таблица проверки: номер и вердикт учителя. */
  tasks: readonly { no: string; verdict: ReviewTaskVerdict }[]
  /** Рамки учителя, сделанные из находок ИИ (`AttemptNoteRegion.findingId`). */
  takenNotes?: readonly { findingId: string | null; taskNo: string | null }[]
  /** «Мимо» (§209). */
  dismissedFindingIds?: Iterable<string>
  /** Убраны крестиком в списке «Пометки ИИ, которые увидит ученик». */
  removedIds?: Iterable<string>
}

/**
 * План переноса. Порядок — по номеру задания («2» перед «10»), внутри задания
 * — как находки пришли от ИИ: в таком порядке их читает и учитель в списке, и
 * ученик в «По заданиям».
 */
export function planAiMarksForStudent<F extends Pick<AiFindingRow, 'id' | 'text' | 'position'> & { task?: string | null }>(
  input: AiMarksInput<F>,
): AiMarksPlan<F> {
  const dismissed = new Set(input.dismissedFindingIds ?? [])
  const removed = new Set(input.removedIds ?? [])
  const currentIds = new Set(input.findings.map(f => f.id))
  const taken = new Set<string>()
  // Задания, на которых уже лежит пометка из ДРУГОЙ проверки ИИ: её находки
  // нет среди текущих, значит, это прошлый прогон — тот же разбор другими id.
  const markedTasks = new Set<string>()
  for (const note of input.takenNotes ?? []) {
    if (!note.findingId) continue
    taken.add(note.findingId)
    const key = normalizeTaskNo(note.taskNo)
    if (key && !currentIds.has(note.findingId)) markedTasks.add(key)
  }
  const verdictOf = new Map<string, { no: string; verdict: ReviewTaskVerdict }>()
  for (const row of input.tasks) {
    const key = normalizeTaskNo(row.no)
    if (key && !verdictOf.has(key)) verdictOf.set(key, { no: row.no.trim(), verdict: row.verdict })
  }

  const plan: AiMarksPlan<F> = { chosen: [], removed: [], eligible: [], dropped: [] }
  const ordered = [...input.findings].sort((a, b) => {
    const byTask = compareTaskNo(taskNoOfFinding(a), taskNoOfFinding(b))
    return byTask || (a.position ?? 0) - (b.position ?? 0)
  })
  for (const finding of ordered) {
    if (taken.has(finding.id) || dismissed.has(finding.id)) continue
    if (!String(finding.text ?? '').trim()) continue
    const key = taskNoOfFinding(finding)
    if (!key) {
      plan.dropped.push({ finding, taskNo: null, reason: 'no-task' })
      continue
    }
    const row = verdictOf.get(key)
    const taskNo = row?.no ?? key
    if (!row) {
      plan.dropped.push({ finding, taskNo, reason: 'unknown-task' })
      continue
    }
    if (!verdictSendsAiMarks(row.verdict)) {
      plan.dropped.push({ finding, taskNo, reason: row.verdict === 'correct' ? 'correct' : 'unchecked' })
      continue
    }
    if (markedTasks.has(key)) {
      plan.dropped.push({ finding, taskNo, reason: 'already-marked' })
      continue
    }
    const off = removed.has(finding.id)
    if (off) plan.removed.push({ finding, taskNo })
    else plan.chosen.push({ finding, taskNo })
    plan.eligible.push({ finding, taskNo, removed: off })
  }
  return plan
}

/** Есть ли что показывать в строке над вердиктом: хоть одна находка подходит. */
export function hasEligibleAiMarks(plan: AiMarksPlan<unknown>): boolean {
  return plan.eligible.length > 0
}

/** Подпись причины — серым в списке. */
export function aiMarkDropLabel(item: AiMarkDropped<unknown>): string {
  switch (item.reason) {
    case 'correct': return 'Не уйдёт: вы отметили «верно»'
    case 'unchecked': return 'Не уйдёт: задание не сверено'
    case 'no-task': return 'Не уйдёт: ИИ не назвала номер задания'
    case 'unknown-task': return `Не уйдёт: задания №${item.taskNo} нет в таблице`
    case 'already-marked': return 'Не уйдёт: по заданию уже есть пометка из прошлой проверки ИИ'
  }
}

/** «№4, №5, №12» — номера по одному разу, не больше `max`, дальше «…». */
export function aiMarkNumbers(items: readonly AiMarkItem<unknown>[], max = 6): string {
  const nos: string[] = []
  for (const item of items) {
    const no = item.taskNo ?? ''
    if (no && !nos.includes(no)) nos.push(no)
  }
  const shown = nos.slice(0, max).map(no => `№${no}`).join(', ')
  return nos.length > max ? `${shown}…` : shown
}

/** «Показать ученику 2 пометки ИИ (№4, №5)». */
export function aiMarksToggleLabel(items: readonly AiMarkItem<unknown>[]): string {
  const n = items.length
  const nos = aiMarkNumbers(items)
  return `Показать ученику ${n} ${plural(n, 'пометку', 'пометки', 'пометок')} ИИ${nos ? ` (${nos})` : ''}`
}

/**
 * Тост после вердикта: «Принято · 4. Ученику ушла работа, пометок на фото: 5».
 * Число — все рамки, которые ученик увидит на фото: свои учителя, взятые
 * раньше и перенесённые сейчас.
 */
export function verdictToastText(
  decision: 'accepted' | 'returned_for_revision',
  score: number | null | undefined,
  marksOnPhoto: number,
): string {
  const head = decision === 'accepted'
    ? (score != null ? `Принято · ${score}` : 'Принято')
    : 'Возвращено на доработку'
  return `${head}. Ученику ушла работа, пометок на фото: ${marksOnPhoto}`
}
