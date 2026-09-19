/**
 * Рамки, перенесённые из находок ИИ: пометка источника и правила повтора
 * (§207).
 *
 * Зачем это понадобилось. «Перенести рамки» складывал находки в
 * `annotation_sets` как обычные пометки — без единого признака, откуда они
 * взялись. После «Проверить заново» преподаватель жал кнопку снова, и те же
 * три «Вычислительная ошибка, стр. 2» ложились вторым и третьим слоем: в базе
 * у одной попытки оказалось 11 объектов против 4 находок последнего прогона.
 *
 * Правило здесь одно и оно важнее удобства: **ручную рамку не трогаем
 * никогда**. Её нарисовал человек, и восстановить её неоткуда. Поэтому
 * «заменяются ранее перенесённые из ИИ» опирается не на похожесть текста, а на
 * явную пометку `source.kind === 'ai'`, которую ставим только мы. Всё, что без
 * пометки, для переноса — чужое.
 *
 * Отдельный случай — дубли, накопленные до §207: пометки источника у них нет,
 * отличить их от ручных нечем. Поэтому их не чистит никакой автомат; есть
 * только видимая кнопка, и убирает она лишь точные совпадения (та же страница,
 * тот же текст, почти тот же прямоугольник), оставляя по одному экземпляру.
 */

export interface FrameRect { x: number; y: number; w: number; h: number }

/** Откуда рамка. Пока источник один — находка ИИ. */
export interface FrameSource {
  kind: 'ai'
  /** id находки (`topic_homework_ai_findings.id`). */
  finding: string
  /** id прогона — чтобы было видно, из какой проверки рамка. */
  job?: string | null
}

/**
 * Пометка страницы, как она лежит в `annotation_sets.data.objects`.
 *
 * Структурный тип, а не импорт из `SubmissionReviewer`: там `Mark` —
 * объединение с легаси-штрихами и внутрь компонента не экспортируется, а этим
 * правилам нужны только три поля.
 */
export interface FrameObject {
  id: string
  type: string
  rect?: FrameRect
  text?: string
  source?: FrameSource | null
}

/**
 * Насколько близкими считаем два прямоугольника при поиске повторов — доля
 * страницы. 0,01 по A4 — около 2 мм: модель на повторном прогоне называет те
 * же координаты с точностью до третьего знака, а человек в такой допуск дважды
 * не попадает.
 */
export const FRAME_RECT_EPS = 0.01

export function isRegionMark(mark: FrameObject | null | undefined): boolean {
  return mark?.type === 'region'
}

/** Рамка пришла из находки ИИ и помечена этим при переносе. */
export function isAiFrame(mark: FrameObject | null | undefined): boolean {
  return isRegionMark(mark) && mark?.source?.kind === 'ai'
}

export function rectsNearlyEqual(
  a: FrameRect | undefined,
  b: FrameRect | undefined,
  eps = FRAME_RECT_EPS,
): boolean {
  if (!a || !b) return false
  return Math.abs(a.x - b.x) <= eps
    && Math.abs(a.y - b.y) <= eps
    && Math.abs(a.w - b.w) <= eps
    && Math.abs(a.h - b.h) <= eps
}

/**
 * Страница после повторного переноса: ранее перенесённые из ИИ убраны, новые
 * положены следом, всё остальное — ручные рамки, легаси-штрихи, чужие
 * пометки — осталось на месте и в прежнем порядке.
 */
export function replaceAiFrames<T extends FrameObject>(
  objects: readonly T[],
  incoming: readonly T[],
): T[] {
  return [...objects.filter(mark => !isAiFrame(mark)), ...incoming]
}

/**
 * id повторов на одной странице — все, кроме первого в каждой группе.
 *
 * «Точное совпадение» — это одинаковый непустой текст и почти одинаковый
 * прямоугольник. Пустой текст из сравнения выброшен намеренно: две безымянные
 * рамки рядом — обычная разметка, а не дубль.
 */
export function duplicateFrameIds(objects: readonly FrameObject[]): string[] {
  const kept: FrameObject[] = []
  const dups: string[] = []
  for (const mark of objects) {
    if (!isRegionMark(mark)) continue
    const text = (mark.text ?? '').trim()
    if (!text) continue
    const twin = kept.find(
      other => (other.text ?? '').trim() === text && rectsNearlyEqual(other.rect, mark.rect),
    )
    if (twin) dups.push(mark.id)
    else kept.push(mark)
  }
  return dups
}

/** Страница без повторов: по одному экземпляру каждой пары. */
export function withoutDuplicateFrames<T extends FrameObject>(objects: readonly T[]): T[] {
  const drop = new Set(duplicateFrameIds(objects))
  return objects.filter(mark => !drop.has(mark.id))
}

/** Сколько повторов на всех страницах разом — число для кнопки. */
export function countDuplicateFrames(
  pages: Record<string, { objects: readonly FrameObject[] }>,
): number {
  let total = 0
  for (const page of Object.values(pages)) total += duplicateFrameIds(page.objects ?? []).length
  return total
}
