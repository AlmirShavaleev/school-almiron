import { AlertCircle, Check, Copy, Link as LinkIcon, Loader2 } from 'lucide-react'
import { QrCode } from '@/components/shared/QrCode'
import { startCommandFor } from '@/lib/telegramLinkApi'

/**
 * «Ждём подтверждения» — визуал общий для настроек и карточки-приглашения
 * при входе (board/011). Раньше эта разметка жила только в SettingsPage;
 * TelegramOnboarding вместо неё дёргал `window.open(url)` ПОСЛЕ `await`, а
 * мобильные браузеры такое окно молча блокируют как всплывающее — человек
 * жал «Привязать» и упирался в тишину. Настоящая ссылка `<a href>`, на
 * которую нажимают сами, попапом не считается ни у кого.
 */
export function TelegramLinkWaiting({
  linkUrl,
  copied,
  onCopyCommand,
  showQr = true,
}: {
  linkUrl: string
  copied: boolean
  onCopyCommand: () => void
  showQr?: boolean
}) {
  const command = startCommandFor(linkUrl)

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {showQr && <QrCode value={linkUrl} />}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <LinkIcon size={15} className="text-blue-500 shrink-0" />
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-700 underline underline-offset-2 break-all"
            >
              {linkUrl}
            </a>
          </div>
          <p className="text-xs text-gray-400">
            Ссылка действует час. Откройте её на телефоне{showQr ? ' или отсканируйте QR' : ''} — платформа сама заметит подключение.
          </p>
        </div>
      </div>

      {command && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-orange-500 shrink-0" />
          <div className="min-w-0 flex-1 text-sm text-orange-800">
            Если бот открылся и молчит — отправьте ему <code className="rounded bg-orange-100 px-1 py-0.5 font-mono text-xs">{command}</code>
          </div>
          <button
            type="button"
            onClick={onCopyCommand}
            title="Скопировать команду"
            className="shrink-0 flex items-center gap-1 rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" />Ждём подтверждения от бота…
      </div>
    </div>
  )
}
