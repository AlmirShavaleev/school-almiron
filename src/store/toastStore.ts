import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

/** Сколько висит обычный тост. */
const DEFAULT_TOAST_MS = 4500

/**
 * Короткий тост — для подтверждений, которые человек ждёт прямо сейчас
 * («Успешно сохранено» после прикрепления файла, §98). Владелец просил 1–2
 * секунды: подтверждение действия, которое пользователь только что сделал сам,
 * не должно висеть наравне с сообщением об ошибке.
 */
export const SHORT_TOAST_MS = 1500

interface ToastState {
  toasts: ToastItem[]
  add: (type: ToastType, message: string, durationMs?: number) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (type, message, durationMs = DEFAULT_TOAST_MS) => {
    const id = Math.random().toString(36).slice(2)
    set(s => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), durationMs)
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

export const toast = {
  success: (msg: string, durationMs?: number) => useToastStore.getState().add('success', msg, durationMs),
  error:   (msg: string) => useToastStore.getState().add('error', msg),
  info:    (msg: string) => useToastStore.getState().add('info', msg),
  warning: (msg: string) => useToastStore.getState().add('warning', msg),
  /** Подтверждение сохранения: один текст на весь проект, один срок жизни. */
  saved:   (msg = 'Успешно сохранено') =>
    useToastStore.getState().add('success', msg, SHORT_TOAST_MS),
}
