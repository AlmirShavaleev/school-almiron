/**
 * §263. Флажки выдачи варианта «после сдачи показать правильные ответы /
 * разбор» (`test_variant_assignments.show_answers_after_submit`,
 * `show_solutions_after_submit`). До §263 их не применял никто — ученик
 * видел всё; теперь эталон и разбор не отдаёт сервер
 * (`get_variant_items_for_student`), а страница варианта объясняет почему
 * (`my_variant_answer_flags`). Уже выданным вариантам миграция поставила оба
 * флажка — поведение у них прежнее.
 */
export interface VariantAnswerFlags {
  showAnswers: boolean
  showSolutions: boolean
  /** Сейчас у ученика идёт работа по времени / пробник — ответы закрыты до её конца. */
  workMode: boolean
}

/** Всё показывать — прежнее поведение (нет функции, старая база, сбой). */
export const SHOW_ALL: VariantAnswerFlags = { showAnswers: true, showSolutions: true, workMode: false }

export function parseVariantAnswerFlags(raw: unknown): VariantAnswerFlags {
  if (!raw || typeof raw !== 'object') return SHOW_ALL
  const r = raw as Record<string, unknown>
  return {
    showAnswers: r.show_answers !== false,
    showSolutions: r.show_solutions !== false,
    workMode: r.work_mode === true,
  }
}

/** Подпись у выдачи в списке назначений: «ответы и разбор», «только ответы», «ничего не показывать». */
export function afterSubmitLabel(answers: boolean | null | undefined, solutions: boolean | null | undefined): string {
  const a = answers !== false
  const s = solutions !== false
  if (a && s) return 'ответы и разбор'
  if (a) return 'только ответы'
  if (s) return 'только разбор'
  return 'ничего не показывать'
}

/** Что сказать ученику на странице сданного варианта, если что-то скрыто; null — всё видно. */
export function hiddenAfterSubmitNote(f: VariantAnswerFlags): string | null {
  if (f.workMode) return 'Сейчас идёт проверочная работа — правильные ответы и разбор откроются, когда она закончится.'
  if (!f.showAnswers && !f.showSolutions) return 'Учитель не показывает правильные ответы и разбор этого варианта. Свои ответы и баллы видны.'
  if (!f.showAnswers) return 'Учитель не показывает правильные ответы этого варианта. Свои ответы и баллы видны.'
  if (!f.showSolutions) return 'Учитель не показывает разбор этого варианта — только правильные ответы.'
  return null
}

/** Показывать ли столбец «Правильный ответ» и вердикт по эталону на клиенте. */
export function answersVisible(f: VariantAnswerFlags): boolean {
  return f.showAnswers && !f.workMode
}
