import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, X, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useTelegramOnboardingDismissed } from '@/store/telegramOnboardingStore'
import { telegramBenefit, telegramPromptFor } from '@/lib/telegramOnboarding'
import { fetchOwnTelegramLinked, requestTelegramLink, sendTelegramTest } from '@/lib/telegramLinkApi'
import { toast } from '@/store/toastStore'

/**
 * Сколько ждём возвращения человека из Telegram. Привязку подтверждает бот на
 * своей стороне, поэтому вкладка узнаёт о ней только опросом. Две минуты —
 * с запасом на «открыл, нашёл бота, нажал start»; дольше держать таймер
 * бессмысленно, статус всё равно подтянется при следующем заходе.
 */
const POLL_TOTAL_MS    = 120_000
const POLL_INTERVAL_MS = 3_000

export function TelegramOnboarding() {
  const profile = useAuthStore(s => s.profile)
  const { dismissed, dismiss } = useTelegramOnboardingDismissed()

  const [linked,  setLinked]  = useState<boolean | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [waiting, setWaiting] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    fetchOwnTelegramLinked(profile.id)
      .then(v => { if (!cancelled) setLinked(v) })
      // Молча считаем «не привязан» нельзя: тогда карточка полезет к тем, у
      // кого всё привязано. Неизвестность — это «ничего не показываем».
      .catch(() => { if (!cancelled) setLinked(true) })
    return () => { cancelled = true }
  }, [profile?.id])

  /** Опрос после ухода в Telegram: ловим момент, когда бот подтвердил привязку. */
  const pollUntilLinked = useCallback((profileId: string) => {
    const deadline = Date.now() + POLL_TOTAL_MS
    setWaiting(true)

    const tick = () => {
      fetchOwnTelegramLinked(profileId)
        .then(ok => {
          if (ok) {
            setLinked(true)
            setWaiting(false)
            toast.success('Готово, уведомления включены')
            // Пробное сообщение — чтобы человек увидел живой канал, а не
            // поверил на слово. Своя ошибка тут ничего не отменяет.
            sendTelegramTest().catch(() => {})
            return
          }
          if (Date.now() < deadline) {
            timers.current.push(window.setTimeout(tick, POLL_INTERVAL_MS))
          } else {
            setWaiting(false)
          }
        })
        .catch(() => setWaiting(false))
    }

    timers.current.push(window.setTimeout(tick, POLL_INTERVAL_MS))
  }, [])

  async function handleConnect() {
    if (!profile?.id || busy) return
    setBusy(true)
    try {
      const url = await requestTelegramLink()
      // Новая вкладка, а не переход: человек не теряет то, что делал в кабинете.
      window.open(url, '_blank', 'noopener,noreferrer')
      pollUntilLinked(profile.id)
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось создать ссылку')
    } finally {
      setBusy(false)
    }
  }

  // Пока статус неизвестен — не мигаем карточкой у тех, у кого всё привязано.
  if (linked === null) return null

  const prompt = telegramPromptFor(profile?.role, linked, dismissed)
  if (prompt === null) return null

  const { title, body } = telegramBenefit(profile?.role)

  if (prompt === 'strip') {
    return (
      <div
        data-testid="tg-onboarding-strip"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary-200
                   bg-primary-50/70 px-3.5 py-2 text-sm text-primary-900"
      >
        <Send size={15} className="shrink-0 text-primary-700" />
        <span className="min-w-0 flex-1">Telegram не привязан — уведомления не приходят.</span>
        <button
          onClick={handleConnect}
          disabled={busy || waiting}
          className="shrink-0 font-semibold text-primary-800 hover:text-primary-950 disabled:opacity-50"
        >
          {busy || waiting ? 'Ожидаем…' : 'Привязать'}
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="tg-onboarding-card"
      className="mb-4 rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 to-white
                 p-4 sm:p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-800 text-white">
          <Send size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold leading-tight text-graphite-950">{title}</h3>
          <p className="mt-1 text-sm leading-snug text-slate-600">{body}</p>

          {/* На телефоне кнопки встают в столбик и остаются нажимаемыми */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={handleConnect}
              disabled={busy || waiting}
              data-testid="tg-onboarding-connect"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-800 px-4 py-2
                         text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {(busy || waiting) && <Loader2 size={14} className="animate-spin" />}
              {waiting ? 'Ждём подтверждения…' : 'Привязать Telegram'}
            </button>

            <button
              onClick={dismiss}
              className="rounded-xl px-3 py-2 text-sm text-slate-500 transition-colors hover:text-slate-700"
            >
              Позже
            </button>

            <Link
              to="/settings"
              className="px-1 text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline sm:ml-auto"
            >
              Настройки уведомлений
            </Link>
          </div>

          {waiting && (
            <p className="mt-2 text-xs text-slate-500">
              Откройте бота и нажмите «Старт» — вкладка сама заметит привязку.
            </p>
          )}
        </div>

        <button
          onClick={dismiss}
          aria-label="Скрыть"
          className="shrink-0 text-slate-400 transition-colors hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
