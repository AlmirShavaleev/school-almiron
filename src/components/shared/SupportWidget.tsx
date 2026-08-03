import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, ImagePlus, LifeBuoy, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

const SUBJECT_MIN = 3
const SUBJECT_MAX = 120
const MESSAGE_MIN = 10
const MESSAGE_MAX = 2000
const FILES_MAX   = 5
const FILE_SIZE_MAX = 5 * 1024 * 1024
const MIME_ALLOWED = ['image/png', 'image/jpeg', 'image/webp']

const BUCKET = 'support-attachments'

/**
 * Коды из RPC переводим здесь: в базе тексты для человека не хранятся.
 */
function humanError(raw: string): string {
  if (raw.includes('SUBJECT_TOO_SHORT'))    return `Тема — минимум ${SUBJECT_MIN} символа.`
  if (raw.includes('SUBJECT_TOO_LONG'))     return `Тема — максимум ${SUBJECT_MAX} символов.`
  if (raw.includes('MESSAGE_TOO_SHORT'))    return `Опишите подробнее — минимум ${MESSAGE_MIN} символов.`
  if (raw.includes('MESSAGE_TOO_LONG'))     return `Слишком длинно — максимум ${MESSAGE_MAX} символов.`
  if (raw.includes('TOO_MANY_ATTACHMENTS')) return `Не больше ${FILES_MAX} скриншотов.`
  if (raw.includes('ATTACHMENT_'))          return 'Не удалось приложить скриншот. Попробуйте ещё раз.'
  if (raw.includes('AUTH_REQUIRED'))        return 'Нужно войти в систему.'
  const rate = raw.match(/RATE_LIMITED:(\d+)/)
  if (rate) {
    const sec = Number(rate[1])
    return sec > 60
      ? `Слишком часто. Следующее сообщение можно отправить через ${Math.ceil(sec / 60)} мин.`
      : `Слишком часто. Следующее сообщение можно отправить через ${sec} с.`
  }
  return 'Не удалось отправить. Попробуйте ещё раз.'
}

/** Имя файла в пути: кириллица и пробелы в ключе объекта только мешают. */
function safeName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '.png'
  return `shot${ext}`
}

export function SupportWidget() {
  const profile  = useAuthStore(s => s.profile)
  const location = useLocation()

  const [open,    setOpen]    = useState(false)
  const [shown,   setShown]   = useState(false)   // отдельно от open — ради анимации входа
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [files,   setFiles]   = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Панель монтируется скрытой и разворачивается на следующем кадре — иначе
  // переход не проигрывается, элемент появляется сразу в конечном состоянии.
  useEffect(() => {
    if (!open) { setShown(false); return }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!profile) return null

  function handleOpen() {
    setSubject(''); setMessage(''); setFiles([]); setError(null); setSent(false)
    setOpen(true)
  }

  function handleClose() {
    setShown(false)
    // даём анимации выхода доиграть до размонтирования
    window.setTimeout(() => setOpen(false), 160)
  }

  function addFiles(picked: FileList | null) {
    if (!picked) return
    setError(null)
    const next = [...files]
    for (const f of Array.from(picked)) {
      if (next.length >= FILES_MAX) { setError(`Не больше ${FILES_MAX} скриншотов.`); break }
      if (!MIME_ALLOWED.includes(f.type)) { setError('Только изображения: PNG, JPEG или WebP.'); continue }
      if (f.size > FILE_SIZE_MAX) { setError('Файл больше 5 МБ.'); continue }
      next.push(f)
    }
    setFiles(next)
    if (fileInput.current) fileInput.current.value = ''
  }

  const subjectOk = subject.trim().length >= SUBJECT_MIN && subject.trim().length <= SUBJECT_MAX
  const messageOk = message.trim().length >= MESSAGE_MIN && message.length <= MESSAGE_MAX
  const canSend   = subjectOk && messageOk && !sending

  async function handleSubmit() {
    if (!canSend) return
    setSending(true); setError(null)
    try {
      // Скриншоты уезжают в приватный бакет, в обращение попадают только пути.
      const folder = crypto.randomUUID()
      const paths: string[] = []
      for (const f of files) {
        const path = `${profile!.id}/${folder}/${paths.length + 1}-${safeName(f.name)}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, {
          contentType: f.type, upsert: false,
        })
        if (upErr) throw upErr
        paths.push(path)
      }

      const { error: e } = await supabase.rpc('submit_support_request', {
        p_subject:     subject.trim(),
        p_message:     message.trim(),
        p_page_path:   location.pathname + location.search,
        p_attachments: paths,
      })
      if (e) throw e
      setSent(true)
    } catch (e: any) {
      setError(humanError(String(e?.message ?? e)))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Плавающая кнопка — правый нижний угол, на любой странице */}
      {!open && (
        <button
          onClick={handleOpen}
          data-testid="support-widget-button"
          aria-label="Сообщить о проблеме"
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-primary-900 text-white
                     shadow-xl shadow-primary-950/25 flex items-center justify-center
                     hover:bg-primary-800 hover:scale-105 active:scale-95
                     transition-all duration-200"
        >
          <LifeBuoy size={22} />
        </button>
      )}

      {open && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
            onClick={handleClose}
            aria-hidden
          />

          <div
            data-testid="support-widget-panel"
            className={`fixed bottom-5 right-5 z-50 w-[min(92vw,380px)] bg-white rounded-2xl
                        shadow-2xl border border-slate-200 origin-bottom-right
                        transition-all duration-200 ease-out
                        ${shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
          >
            <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                  <LifeBuoy size={18} className="text-primary-800" />
                </div>
                <div>
                  <h2 className="font-bold text-graphite-950 text-[15px] leading-tight">Сообщить о проблеме</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Что пошло не так?</p>
                </div>
              </div>
              <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 ml-3" aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>

            {sent ? (
              <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
                <CheckCircle2 size={38} className="text-green-500" />
                <div className="font-semibold text-graphite-950">Отправлено</div>
                <p className="text-sm text-slate-500">Спасибо. Мы разберёмся.</p>
                <button
                  onClick={handleClose}
                  className="mt-1 px-4 py-2 text-sm font-bold text-white bg-primary-800 hover:bg-primary-700 rounded-xl transition-colors"
                >
                  Закрыть
                </button>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 space-y-3">
                  <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    autoFocus
                    maxLength={SUBJECT_MAX}
                    placeholder="Тема"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-graphite-950
                               placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30
                               focus:border-primary-400"
                  />

                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={4}
                    maxLength={MESSAGE_MAX + 100}
                    placeholder="Опишите, что случилось"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-graphite-950
                               placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30
                               focus:border-primary-400 resize-none"
                  />

                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {files.map((f, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 group">
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white
                                       flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Убрать скриншот"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => fileInput.current?.click()}
                      disabled={files.length >= FILES_MAX}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary-700
                                 disabled:opacity-40 transition-colors"
                    >
                      <ImagePlus size={15} />
                      Прикрепить скриншот
                    </button>
                    <span className="text-xs text-slate-400">{message.length} / {MESSAGE_MAX}</span>
                  </div>

                  <input
                    ref={fileInput}
                    type="file"
                    accept={MIME_ALLOWED.join(',')}
                    multiple
                    hidden
                    onChange={e => addFiles(e.target.files)}
                  />

                  {error && (
                    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                      {error}
                    </div>
                  )}
                </div>

                <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end">
                  <button
                    onClick={handleSubmit}
                    disabled={!canSend}
                    data-testid="support-widget-submit"
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white
                               bg-primary-800 hover:bg-primary-700 rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : null}
                    Отправить
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
