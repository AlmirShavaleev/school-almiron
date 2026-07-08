/**
 * Draft context for "собрать новую подборку из карточки занятия".
 * Deliberately a separate localStorage key from the cart store —
 * this only remembers WHICH lesson to return to after saving a
 * collection in the catalog/cart flow; it never touches cart items.
 * Survives page reload (spec requirement), cleared once consumed.
 */
const KEY = 'almiron:lesson-homework-draft-context'

export function setLessonHomeworkDraftContext(lessonId: string) {
  localStorage.setItem(KEY, JSON.stringify({ lessonId }))
}

export function getLessonHomeworkDraftContext(): { lessonId: string } | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function clearLessonHomeworkDraftContext() {
  localStorage.removeItem(KEY)
}
