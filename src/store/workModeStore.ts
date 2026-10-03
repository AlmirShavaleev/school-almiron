import { create } from 'zustand'
import { safeRpc } from '@/lib/safeRpc'
import { parseWorkMode, type WorkMode } from '@/lib/workMode'

/**
 * §263. Режим работы ученика — одно состояние на приложение.
 *
 * Читает `my_work_mode()` (определение «идёт работа» — в базе). Перечитывает
 * DashboardLayout (вход, раз в минуту, возврат на вкладку, конец окна) и
 * страница работы — сразу после сдачи: «сданная работа → режим снимается
 * сразу». Нет функции (миграция не применена) или сбой — режима нет: сайт
 * работает как раньше, сервер всё равно держит свои замки.
 */
interface WorkModeState {
  work: WorkMode | null
  /** Разница «сервер − устройство», мс — для таймера полосы. */
  offsetMs: number
  loaded: boolean
  refresh: () => Promise<void>
  reset: () => void
}

let seq = 0

export const useWorkModeStore = create<WorkModeState>((set) => ({
  work: null,
  offsetMs: 0,
  loaded: false,
  refresh: async () => {
    const my = ++seq
    const sentAt = Date.now()
    const { data, error } = await safeRpc('my_work_mode')
    if (my !== seq) return
    if (error) { set({ work: null, loaded: true }); return }
    const work = parseWorkMode(data)
    const receivedAt = Date.now()
    const serverNow = (data as { server_now?: string } | null)?.server_now
    const server = serverNow ? Date.parse(serverNow) : NaN
    set({
      work,
      loaded: true,
      offsetMs: Number.isFinite(server) ? server - (sentAt + receivedAt) / 2 : 0,
    })
  },
  reset: () => { seq += 1; set({ work: null, offsetMs: 0, loaded: false }) },
}))

/** Перечитать режим (после сдачи работы, после конца окна). Безопасно звать где угодно. */
export function refreshWorkMode(): void {
  void useWorkModeStore.getState().refresh()
}
