import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, X, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useTelegramOnboardingDismissed } from '@/store/telegramOnboardingStore'
import { telegramBenefit, telegramPromptFor } from '@/lib/telegramOnboarding'
import { fetchOwnTelegramLinked, requestTelegramLink, sendTelegramTest, startCommandFor } from '@/lib/telegramLinkApi'
import { TelegramLinkWaiting } from '@/components/shared/TelegramLinkWaiting'
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
  // Мастер привязки: idle → waiting → expired — тот же путь, что и на
  // странице настроек (board/011): раньше здесь после `await` дёргался
  // `window.open(url)`, а мобильные браузеры такое окно молча блокируют
  // как всплывающее — человек жал «Привязать» и упирался в тишину.
  // Настоящая ссылка `<a href>`, на которую нажимают сами, не считается
  // попапом никогда.
  const [phase,   setPhase]   = useState<'idle' | 'waiting' | 'expired'>('idle')
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)
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

    const tick = () => {
      fetchOwnTelegramLinked(profileId)
        .then(ok => {
          if (ok) {
            setLinked(true)
            setPhase('idle')
            setLinkUrl(null)
            toast.success('Готово, уведомления включены')
            // Пробное сообщение — чтобы человек увидел живой канал, а не
            // поверил на слово. Своя ошибка тут ничего не отменяет.
            sendTelegramTest().catch(() => {})
            return
          }
          if (Date.now() < deadline) {
            timers.current.push(window.setTimeout(tick, POLL_INTERVAL_MS))
          } else {
            setPhase('expired')
          }
        })
        .catch(() => setPhase('expired'))
    }

    timers.current.push(window.setTimeout(tick, POLL_INTERVAL_MS))
  }, [])

  async function handleConnect() {
    if (!profile?.id || busy) return
    setBusy(true)
    try {
      const url = await requestTelegramLink()
      setLinkUrl(url)
      setPhase('waiting')
      pollUntilLinked(profile.id)
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось создать ссылку')
    } finally {
      setBusy(false)
    }
  }

  async function handleCopyCommand() {
    if (!linkUrl) return
    const command = startCommandFor(linkUrl)
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Не удалось скопировать')
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
        {phase === 'waiting' && linkUrl ? (
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 font-semibold text-primary-800 underline underline-offset-2 hover:text-primary-950"
          >
            Открыть Telegram →
          </a>
        ) : phase === 'expired' ? (
          <>
            <span className="min-w-0 flex-1">Время ожидания истекло.</span>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="shrink-0 font-semibold text-primary-800 hover:text-primary-950 disabled:opacity-50"
            >
              Начать заново
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1">Telegram не привязан — уведомления не приходят.</span>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="shrink-0 font-semibold text-primary-800 hover:text-primary-950 disabled:opacity-50"
            >
              {busy ? 'Ожидаем…' : 'Привязать'}
            </button>
          </>
        )}
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

          {phase === 'waiting' && linkUrl ? (
            <div className="mt-3">
              <TelegramLinkWaiting linkUrl={linkUrl} copied={copied} onCopyCommand={handleCopyCommand} showQr={false} />
            </div>
          ) : phase === 'expired' ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertCircle size={14} className="shrink-0" />
                Время ожидания истекло. Начните заново.
              </div>
              <button
                onClick={handleConnect}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-800 px-4 py-2
                           text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                <RefreshCw size={14} />Начать заново
              </button>
            </div>
          ) : (
            /* На телефоне кнопки встают в столбик и остаются нажимаемыми */
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                onClick={handleConnect}
                disabled={busy}
                data-testid="tg-onboarding-connect"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-800 px-4 py-2
                           text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Привязать Telegram
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
