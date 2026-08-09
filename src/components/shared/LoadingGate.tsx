import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Экран ожидания с пределом по времени.
 *
 * Владелец поймал на проде первый вход, висевший на спиннере до F5
 * (воспроизвести потом не удалось). Причина не найдена, но класс ошибки
 * известен: любой шаг загрузки, от которого зависит показ приложения, — это
 * промис, и промис может не разрешиться никогда. Сеть повисла, чанк не
 * доехал после деплоя, ответ auth потерялся — и `loading` остаётся `true`
 * навсегда.
 *
 * Поэтому бесконечный спиннер не должен быть достижимым состоянием: через
 * `HARD_LIMIT_MS` пользователь получает объяснение и кнопку, а не крутящийся
 * кружок. Это не лечит причину — это делает её видимой и проходимой.
 *
 * `SOFT_LIMIT_MS` пишет в консоль: если такое повторится, в следующий раз
 * будет запись со временем и подписью шага, а не догадки.
 */

/** Через сколько жаловаться в консоль. */
export const SOFT_LIMIT_MS = 5_000
/** Через сколько показывать ошибку вместо спиннера. */
export const HARD_LIMIT_MS = 20_000

interface LoadingGateProps {
  /** Что именно грузится — попадает в консоль и помогает опознать шаг. */
  label:      string
  /** Во весь экран (загрузка приложения) или внутри страницы. */
  fullScreen?: boolean
  /** Своё сообщение вместо стандартного. */
  message?:   string
}

export function useLoadingWatchdog(label: string) {
  const [slow, setSlow] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const soft = setTimeout(() => {
      setSlow(true)
      // eslint-disable-next-line no-console
      console.warn(`[загрузка] «${label}» идёт дольше ${SOFT_LIMIT_MS / 1000} с`)
    }, SOFT_LIMIT_MS)

    const hard = setTimeout(() => {
      setTimedOut(true)
      // eslint-disable-next-line no-console
      console.error(`[загрузка] «${label}» не завершилась за ${HARD_LIMIT_MS / 1000} с — показываем ошибку`)
    }, HARD_LIMIT_MS)

    return () => { clearTimeout(soft); clearTimeout(hard) }
  }, [label])

  return { slow, timedOut }
}

export function LoadingGate({ label, fullScreen = false, message }: LoadingGateProps) {
  const { slow, timedOut } = useLoadingWatchdog(label)

  const wrap = fullScreen
    ? 'min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-primary-50/30 px-4'
    : 'flex items-center justify-center py-16 px-4'

  if (timedOut) {
    return (
      <div className={wrap}>
        <div
          data-testid="loading-failed"
          role="alert"
          className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
        >
          <h2 className="text-base font-semibold text-graphite-950">Не удалось загрузить</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {message ?? 'Похоже, пропала связь или страница зависла на загрузке. Обновите — обычно этого хватает.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <RefreshCw size={15} />Обновить
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={wrap} role="status" aria-live="polite" data-testid="loading-gate">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-700" />
        {/* Подпись появляется только когда ожидание уже затянулось: на быстрой
            загрузке она мелькнула бы и только мешала. */}
        {slow && (
          <p className="text-xs text-slate-400">Загрузка идёт дольше обычного…</p>
        )}
      </div>
    </div>
  )
}
