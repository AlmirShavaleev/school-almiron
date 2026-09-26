import type { ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'

/**
 * §225. Состояния метки проверки (`VerdictMark`) и их названия — отдельно от
 * компонента, чтобы файл компонента экспортировал только компонент.
 */
export type VerdictMarkState = 'ok' | 'bad' | 'part' | 'unk' | 'none'

export const VERDICT_MARK_LABEL: Record<VerdictMarkState, string> = {
  ok: 'Верно',
  bad: 'Неверно',
  part: 'Частично',
  unk: 'Не сверено',
  none: 'Не решено',
}

/** Вердикт таблицы проверки ДЗ → состояние метки. */
export const MARK_OF_REVIEW_VERDICT: Record<ReviewTaskVerdict, VerdictMarkState> = {
  correct: 'ok',
  wrong: 'bad',
  partial: 'part',
  unchecked: 'unk',
  unsolved: 'none',
}

