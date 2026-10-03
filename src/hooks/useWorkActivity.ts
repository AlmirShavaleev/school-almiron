import { useEffect, useRef } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { AwayTracker } from '@/lib/awayTracker'

/**
 * §263. Отметки ученика на странице идущей работы: «открыл условие» и уходы
 * со страницы. Обе пишет только база (`work_mark_opened`, `work_report_away`):
 * про себя и только пока идёт своя работа — вне окна вызов ничего не пишет.
 * Ошибки глотаются: отметка — сведения для учителя, работу она не ломает.
 *
 * RPC нет в сгенерированных типах (перегенерирует оркестратор) — через `safeRpc`.
 */

/** Первое открытие условия идущей работы по времени. Один вызов на ДЗ за жизнь страницы. */
export function useWorkOpenMark(homeworkId: string | null, live: boolean) {
  const marked = useRef<string | null>(null)
  useEffect(() => {
    if (!homeworkId || !live || marked.current === homeworkId) return
    marked.current = homeworkId
    // Сбой — учитель увидит «пишет» по первому фото.
    void safeRpc('work_mark_opened', { p_homework_id: homeworkId })
  }, [homeworkId, live])
}

/** Клик, после которого уход со страницы — «свой» (камера, выбор файла, условие в новой вкладке). */
export function isExcusedClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  // В зоне «своих» уходов (условие работы) — только ссылки и кнопки, открывающие
  // файл: просто щелчок по странице условия уход не оправдывает.
  const control = target.closest('a, button, label')
  if (control && control.closest('[data-away-ok]')) return true
  if (target.closest('input[type="file"]')) return true
  const label = target.closest('label')
  return !!label?.querySelector('input[type="file"]')
}

/**
 * Считать уходы со страницы, пока `active` (идёт своя работа, не предпросмотр).
 * Ровно одна из `homeworkId` / `mockExamId`. Ученику ничего не возвращает —
 * счётчик видит только учитель.
 */
export function useAwayTracker({ homeworkId = null, mockExamId = null, active }: {
  homeworkId?: string | null
  mockExamId?: string | null
  active: boolean
}) {
  useEffect(() => {
    if (!active || (!homeworkId && !mockExamId) || typeof document === 'undefined') return
    const tracker = new AwayTracker({
      now: () => Date.now(),
      send: async ({ leaves, seconds }) => {
        const { error } = await safeRpc('work_report_away', {
          p_homework_id: homeworkId, p_mock_exam_id: homeworkId ? null : mockExamId,
          p_leaves: leaves, p_away_seconds: seconds,
        })
        if (error) throw new Error(error.message)
      },
    })

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') tracker.leave()
      else if (document.hasFocus()) tracker.back()
    }
    const onBlur = () => {
      // Фокус ушёл во встроенный просмотрщик (iframe PDF) — ученик на странице.
      if (document.activeElement instanceof HTMLIFrameElement) return
      tracker.leave()
    }
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') tracker.back()
    }
    const onPageHide = () => { tracker.leave(); void tracker.stop() }
    const onClick = (e: Event) => { if (isExcusedClick(e.target)) tracker.excuseNextLeave() }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('click', onClick, true)
    const id = window.setInterval(() => tracker.tick(), 5_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('click', onClick, true)
      window.clearInterval(id)
      void tracker.stop()
    }
  }, [homeworkId, mockExamId, active])
}
