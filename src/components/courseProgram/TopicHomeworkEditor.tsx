import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { usePasteFiles } from '@/hooks/usePasteFiles'
import { nextScreenshotIndex } from '@/lib/clipboardFiles'
import { TopicHomeworkNotify } from '@/components/courseProgram/TopicHomeworkNotify'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SignedImage } from '@/components/ui/SignedImage'
import { TOPIC_HOMEWORK_BUCKET, defaultGradeScale, formatBytes, type GradeScale } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { toast } from '@/store/toastStore'
import { useTimedSummary } from '@/hooks/useTimedWork'
import { supabase } from '@/lib/supabase'
import { describeDigestEta, homeworkIssueStatus, type HomeworkIssueState } from '@/lib/homeworkIssue'
import {
  TOPIC_KIND_LABEL, durationLabel, formatMoscowTime, isTimedKind, normalizeTopicKind, parseWindowDraft,
  windowDraftOf, type WindowDraft,
} from '@/lib/timedWork'

const MAX_FILE_SIZE = 50 * 1024 * 1024

/** Картинка ли это — по расширению имени файла. */
function isImageName(name: string | null): boolean {
  const ext = (name?.includes('.') ? name.split('.').pop() ?? '' : '').toUpperCase()
  return /^(PNG|JPG|JPEG|WEBP|GIF|HEIC|HEIF)$/.test(ext)
}

/** §243. Цвет плашки статуса выдачи — как в макете: зелёная, серая, янтарная. */
const ISSUE_TONE: Record<HomeworkIssueState, string> = {
  issued: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-gray-200 bg-gray-50 text-gray-600',
  no_files: 'border-amber-200 bg-amber-50 text-amber-800',
  template: 'border-primary-100 bg-primary-50 text-primary-700',
}
const ISSUE_DOT: Record<HomeworkIssueState, string> = {
  issued: 'bg-emerald-500', closed: 'bg-gray-400', no_files: 'bg-amber-500', template: 'bg-primary-400',
}

/**
 * Преподавательский блок ДЗ темы: прикрепить файлы, задать дедлайн и баллы,
 * оповестить в Telegram.
 *
 * §243: кнопки «Опубликовать» больше нет. ДЗ выдаётся само, пока тема открыта
 * (тумблер или дата) и у него есть файл; скрыть выданное ДЗ открытой темы
 * нельзя. Вместо кнопки — статус выдачи и время, когда уйдёт сводка ученикам.
 *
 * Названия и инструкции в интерфейсе нет: ДЗ — это прикреплённые файлы.
 * Сама строка ДЗ создаётся лениво, при первом действии преподавателя.
 *
 * Работ учеников здесь НЕТ (§117). Аккордеон «Работы учеников» из §93 убран
 * вместе со своими запросами: проверка живёт в разделе «Проверки ДЗ», а
 * модалка темы — про настройку задания. Держать разбор работ в двух местах
 * значило бы чинить его дважды.
 */
export function TopicHomeworkEditor({
  topicId, className, kind = null, isTemplate = false, isOpen = null, availableFrom = null, focusDue = false,
}: {
  topicId: string
  className?: string
  /** §240. Тип темы: у проверочной и контрольной вместо дедлайна — окно времени. */
  kind?: string | null
  /** §240. Шаблон курса: время не ставится, оно своё у каждого класса. */
  isTemplate?: boolean
  /** §243. Открытость темы (тумблер и дата) — от неё зависит, выдано ли ДЗ. */
  isOpen?: boolean | null
  availableFrom?: string | null
  /**
   * §259. Пришли «изменить / задать срок» из таблицы ДЗ: поле дедлайна — в
   * вид и в фокус, как только задание загрузилось (один раз).
   */
  focusDue?: boolean
}) {
  const timed = isTimedKind(kind)
  const {
    homework, files, loading, error,
    createHomework, updateHomework, uploadHomeworkFile, deleteHomeworkFile,
    notifyStudents, loadNotifyTargets,
  } = useTopicHomework(topicId)

  const [dueAt, setDueAt] = useState('')
  // §265. Шкала есть всегда: у урока по умолчанию 100-балльная, у проверочной и
  // контрольной — только 5-балльная (выбора нет). Пустой шкалы («без баллов»)
  // больше не бывает — старое ДЗ без шкалы показываем шкалой по типу темы, её
  // же поставит пересчёт PENDING_265_backfill.
  const scaleDefault = defaultGradeScale(kind)
  const [gradeScale, setGradeScale] = useState<GradeScale>(scaleDefault)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Состояние оповещения переехало внутрь TopicHomeworkNotify: там же список
  // получателей, там же и его загрузка с ошибками.

  // Загрузка файлов: последовательная, с прогрессом по текущему файлу.
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadIndex, setUploadIndex] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ name: string; percent: number } | null>(null)

  // Не даём создать два ДЗ на тему, если преподаватель успел кликнуть дважды:
  // одно и то же обещание переиспользуется, пока оно не упало с ошибкой.
  const ensuringRef = useRef<Promise<void> | null>(null)

  const dueRef = useRef<HTMLInputElement>(null)
  const dueFocused = useRef(false)
  useEffect(() => {
    if (!focusDue || loading || dueFocused.current || !dueRef.current) return
    dueFocused.current = true
    dueRef.current.scrollIntoView?.({ block: 'center' })
    dueRef.current.focus({ preventScroll: true })
  }, [focusDue, loading])

  useEffect(() => {
    setDueAt(homework?.due_at ? homework.due_at.slice(0, 10) : '')
    setGradeScale(timed ? 'five' : homework?.grade_scale ?? scaleDefault)
  }, [homework?.id, homework?.due_at, homework?.grade_scale, timed, scaleDefault])

  // §240. Окно работы по времени: дата + «открывается» + «закрывается» по
  // Москве. Поля держим строкой (как их печатает человек), в базу — только
  // целое и верное окно.
  const [win, setWin] = useState<WindowDraft>(() => windowDraftOf(homework?.opens_at, homework?.closes_at))
  const [winError, setWinError] = useState<string | null>(null)
  useEffect(() => {
    setWin(windowDraftOf(homework?.opens_at, homework?.closes_at))
    setWinError(null)
  }, [homework?.id, homework?.opens_at, homework?.closes_at])
  const { summary } = useTimedSummary(homework?.id ?? null, timed && !isTemplate && !!homework?.closes_at)

  // §243. Статус выдачи — тем же правилом, что у сервера (lib/homeworkIssue).
  const issue = homeworkIssueStatus({
    topic: { is_open: isOpen, available_from: availableFrom },
    fileCount: files.length,
    timed,
    isTemplate,
  })

  // «Сводка ученикам уйдёт в HH:MM» — если по этому ДЗ кому-то ещё не ушло.
  // Перечитываем, когда ДЗ стало выданным или появился файл: выдача и
  // постановка в сводку идут в той же транзакции, что и загрузка файла.
  const [eta, setEta] = useState<{ pending: number; due_at: string | null } | null>(null)
  const homeworkId = homework?.id ?? null
  useEffect(() => {
    if (!homeworkId || issue.state !== 'issued') { setEta(null); return }
    let cancelled = false
    void (async () => {
      try {
        // Функции §243 нет в сгенерированных типах — как у прочих новых RPC.
        const { data, error: err } = await supabase.rpc('topic_homework_digest_eta' as never, { p_homework_id: homeworkId } as never)
        if (!cancelled) setEta(err || !data ? null : (data as { pending: number; due_at: string | null }))
      } catch {
        if (!cancelled) setEta(null)
      }
    })()
    return () => { cancelled = true }
  }, [homeworkId, issue.state, files.length])
  const etaText = eta && eta.pending > 0 ? describeDigestEta(eta.due_at) : null

  function saveWindow(next: WindowDraft) {
    setWin(next)
    const parsed = parseWindowDraft(next)
    if (parsed.kind === 'incomplete') { setWinError(null); return }
    if (parsed.kind === 'invalid') { setWinError(parsed.message); return }
    setWinError(null)
    const patch = parsed.kind === 'ok'
      ? { opens_at: parsed.opensAt, closes_at: parsed.closesAt }
      : { opens_at: null, closes_at: null }
    if ((patch.opens_at ?? null) === (homework?.opens_at ?? null) && (patch.closes_at ?? null) === (homework?.closes_at ?? null)) return
    void run(async () => {
      await ensureHomework()
      await updateHomework(patch)
    })
  }

  /**
   * Создаёт ДЗ, если его ещё нет. Хук после создания синхронно запоминает
   * строку у себя, поэтому следующий шаг обработчика (загрузка файла или
   * сохранение поля) уже работает с готовым ДЗ — ждать ре-рендера не нужно.
   */
  async function ensureHomework(): Promise<void> {
    if (homework) return
    if (!ensuringRef.current) {
      ensuringRef.current = createHomework('', '', { due_at: dueAt || null, grade_scale: gradeScale })
        .then(() => undefined)
        .catch((e: unknown) => {
          ensuringRef.current = null // дать возможность повторить
          throw e
        })
    }
    await ensuringRef.current
  }

  /**
   * `confirmSave` выключается на удалении: «Успешно сохранено» после того, как
   * файл исчез со страницы, читается как ошибка. Всё остальное — сохранение,
   * и оно подтверждается тостом, а не только надписью «Сохранено» в шапке:
   * дедлайн и баллы уходят на сервер по потере фокуса, и владелец этого не
   * замечал (§98).
   */
  async function run(fn: () => Promise<unknown>, confirmSave = true) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      if (confirmSave) toast.saved()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  // Скриншот из буфера (Ctrl+V) — тем же путём, что и выбранный файл.
  // Пока идёт загрузка, вставку не принимаем: очередь здесь последовательная.
  usePasteFiles(
    files => { void handleFilesSelected(files) },
    !uploading,
    nextScreenshotIndex(files.map(f => f.original_filename)),
  )

  async function handleFilesSelected(list: FileList | File[]) {
    const selected = Array.from(list)
    setUploadTotal(selected.length)
    setUploadError(null)
    setLocalError(null)
    setCurrent(null)
    setUploading(true)

    try {
      await ensureHomework()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось создать ДЗ')
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    // Ошибка одного файла не отменяет остальные — просто копим список.
    const failed: string[] = []
    let firstError: string | null = null

    for (let i = 0; i < selected.length; i++) {
      setUploadIndex(i + 1)
      const file = selected[i]

      if (file.size > MAX_FILE_SIZE) {
        failed.push(file.name)
        if (!firstError) firstError = 'Файл слишком большой'
        continue
      }

      try {
        setCurrent({ name: file.name, percent: 0 })
        await uploadHomeworkFile(file, p =>
          setCurrent(c => (c ? { ...c, percent: p } : { name: file.name, percent: p })),
        )
      } catch (e: any) {
        failed.push(file.name)
        if (!firstError) firstError = e?.message ?? 'Ошибка загрузки'
      }
    }

    if (failed.length > 0) {
      setUploadError(`Не загружено: ${failed.join(', ')} (${firstError})`)
    }
    if (selected.length - failed.length > 0) toast.saved()

    setUploading(false)
    setCurrent(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка ДЗ…
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FileText size={15} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">{timed ? TOPIC_KIND_LABEL[normalizeTopicKind(kind)] : 'Домашнее задание'}</span>
          {saved && <span className="text-xs text-emerald-600">Сохранено</span>}
        </div>

        {/*
          §243. Статус выдачи вместо «Черновик / Опубликовано» и кнопки. Что
          видит ученик, решает открытость темы: открыта и есть файл — выдано;
          закрыта — не выдано (и когда откроется, если это решает дата); нет
          файла — ученик увидит ДЗ, как только файл появится.
        */}
        <div data-testid="homework-issue" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-testid="homework-issue-state"
            data-state={issue.state}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold', ISSUE_TONE[issue.state])}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', ISSUE_DOT[issue.state])} />
            {issue.label}
          </span>
          {issue.note && <span className="text-xs text-gray-500">{issue.note}</span>}
        </div>
        {etaText && (
          <p data-testid="homework-digest-eta" className="-mt-1 mb-3 text-xs text-gray-600">
            {etaText}
          </p>
        )}

        {/* 1. Зона загрузки: несколько файлов подряд, с прогрессом */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={e => {
            if (e.target.files) handleFilesSelected(e.target.files)
          }}
          aria-label="Прикрепить PDF или картинки"
          className="hidden"
          disabled={uploading}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 py-8 text-gray-400 transition-colors hover:border-primary-300 hover:text-primary-500',
            uploading && 'cursor-not-allowed opacity-50',
          )}
        >
          {uploading && current ? (
            <div className="w-full max-w-xs">
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span className="truncate">{current.name}</span>
                <span>{current.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${current.percent}%` }} />
              </div>
              <div className="mt-1 text-center text-[11px] text-gray-400">Файл {uploadIndex} из {uploadTotal}</div>
            </div>
          ) : uploading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm font-medium">Загрузка {uploadIndex} из {uploadTotal}…</span>
            </>
          ) : (
            <>
              <Upload size={20} />
              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-medium">Прикрепить PDF или картинки</span>
                <span className="text-xs text-gray-400">или вставьте скриншот через Ctrl+V</span>
                <span className="text-xs">Можно выбрать несколько файлов · до 50 МБ каждый</span>
              </div>
            </>
          )}
        </button>

        {uploadError && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>
        )}

        {/* 2. Что уже прикреплено */}
        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map(f => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
              >
                <SignedFileLink
                  bucket={TOPIC_HOMEWORK_BUCKET}
                  url={f.storage_path}
                  className="inline-flex min-w-0 flex-1 items-center gap-2 text-sm text-primary-600 hover:underline"
                >
                  {/*
                    У картинки — миниатюра вместо общей иконки: строка
                    «скриншот-1.png (74 КБ)» не говорит, что внутри, и владелец
                    жаловался именно на это. PDF остаётся иконкой: его превью
                    здесь не построить.
                  */}
                  {isImageName(f.original_filename) ? (
                    <SignedImage
                      bucket={TOPIC_HOMEWORK_BUCKET}
                      path={f.storage_path}
                      alt={f.original_filename}
                      className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 bg-white object-cover"
                    />
                  ) : (
                    <FileText size={14} className="shrink-0" />
                  )}
                  <span className="truncate">{f.original_filename}</span>
                  {formatBytes(f.size_bytes) && (
                    <span className="shrink-0 text-xs text-gray-400">({formatBytes(f.size_bytes)})</span>
                  )}
                </SignedFileLink>
                <button
                  type="button"
                  onClick={() => run(() => deleteHomeworkFile(f.id), false)}
                  disabled={busy}
                  aria-label={`Удалить файл ${f.original_filename}`}
                  title="Удалить файл"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* §240. Время написания — у проверочной и контрольной вместо дедлайна. */}
        {timed && (
          <div data-testid="timed-window-editor" className="mt-4 rounded-xl border border-primary-100 bg-primary-50/40 p-3">
            <div className="text-xs font-bold uppercase tracking-[0.06em] text-gray-500">Время написания · для этого класса</div>
            {isTemplate ? (
              <p data-testid="timed-window-template" className="mt-1.5 text-sm text-gray-600">
                Время ставится в курсе класса: у каждого класса свой день и час. Из шаблона копируются тип и материалы, время — нет.
              </p>
            ) : (
              <>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1fr_1fr]">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">дата</span>
                    <input
                      type="date"
                      data-testid="timed-window-date"
                      value={win.date}
                      onChange={e => saveWindow({ ...win, date: e.target.value })}
                      aria-label="Дата работы"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">открывается</span>
                    <input
                      type="time"
                      data-testid="timed-window-opens"
                      value={win.opens}
                      onChange={e => saveWindow({ ...win, opens: e.target.value })}
                      aria-label="Открывается"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-gray-500">закрывается</span>
                    <input
                      type="time"
                      data-testid="timed-window-closes"
                      value={win.closes}
                      onChange={e => saveWindow({ ...win, closes: e.target.value })}
                      aria-label="Закрывается"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                  </label>
                </div>
                {winError ? (
                  <p data-testid="timed-window-error" className="mt-1.5 text-xs text-red-600">{winError}</p>
                ) : homework?.opens_at && homework?.closes_at ? (
                  <p className="mt-1.5 text-sm font-bold text-emerald-700">
                    {durationLabel(homework.opens_at, homework.closes_at)} · время московское
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-amber-800">Время не назначено — ученики не могут начать работу и не видят условие.</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  У каждого класса своё время. Ученику, который пропустил, можно открыть работу заново — на вкладке «Домашние задания» курса.
                </p>
              </>
            )}
          </div>
        )}

        {/* §240. После закрытия — сводка: сдали сами / автоматически / не сдали / в классе. */}
        {timed && summary?.closed && (
          <div data-testid="timed-summary" className="mt-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-[0.06em] text-gray-500">После закрытия · сводка</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                [summary.submittedSelf, 'сдали сами'],
                [summary.submittedAuto, `сдано автоматически${summary.closesAt ? ` в ${formatMoscowTime(summary.closesAt)}` : ''}`],
                [summary.notSubmitted, 'не сдали'],
                [summary.inClass, 'в классе'],
              ] as const).map(([n, label]) => (
                <div key={label} className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  <b className="block text-xl font-extrabold tabular-nums text-primary-900">{n}</b>
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Дедлайн и баллы — сохраняются сразу */}
        <div className={cn('mt-4 grid gap-2', !timed && 'sm:grid-cols-2')}>
          {!timed && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Дедлайн</label>
            <input
              ref={dueRef}
              type="date"
              data-testid="hw-due-input"
              value={dueAt}
              onChange={e => {
                const next = e.target.value
                setDueAt(next)
                run(async () => {
                  await ensureHomework()
                  await updateHomework({ due_at: next || null })
                })
              }}
              aria-label="Дедлайн"
              className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <p className="mt-1 text-xs text-gray-400">Не блокирует сдачу — просто напоминание</p>
          </div>
          )}
          {timed ? (
            // §265. Проверочная и контрольная — всегда школьная оценка 2–5: выбирать нечего.
            <div data-testid="hw-grade-scale-fixed">
              <span className="mb-1 block text-xs font-medium text-gray-600">Оценка</span>
              <span className="inline-flex h-10 items-center rounded-xl bg-verdict-ok-tint px-3 text-sm font-bold text-verdict-ok-ink">
                5-балльная · 2–5
              </span>
              <p className="mt-1 text-xs text-gray-500">У проверочной и контрольной шкала всегда школьная: оценка 2, 3, 4 или 5.</p>
            </div>
          ) : (
          <div>
            <label htmlFor={`hw-grade-scale-${topicId}`} className="mb-1 block text-xs font-medium text-gray-600">Шкала баллов</label>
            <select
              id={`hw-grade-scale-${topicId}`}
              data-testid="hw-grade-scale"
              value={gradeScale}
              onChange={e => {
                const next: GradeScale = e.target.value === 'five' ? 'five' : 'hundred'
                const prev = gradeScale
                setGradeScale(next)
                run(async () => {
                  await ensureHomework()
                  try {
                    await updateHomework({ grade_scale: next })
                  } catch (err) {
                    // Сервер не меняет шкалу у ДЗ с выставленными оценками (§265) — вернуть выбор.
                    setGradeScale(prev)
                    throw err
                  }
                })
              }}
              aria-label="Шкала баллов"
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="hundred">100-балльная</option>
              <option value="five">5-балльная (2–5)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Каждое принятое ДЗ получает балл.</p>
          </div>
          )}
        </div>

        {/* §243. Кнопки «Опубликовать» / «Снять с публикации» нет: выдачу
            ставит сервер по открытости темы. Ручное «Напомнить ученикам» (§75)
            остаётся — для выданного ДЗ открытой темы. */}
        {homework && issue.state === 'issued' && (
          <TopicHomeworkNotify
            className="mt-4"
            loadTargets={loadNotifyTargets}
            onNotify={notifyStudents}
          />
        )}

        {/* Блок «Работы учеников» убран по решению владельца (2026-08-04):
            работы смотрят в очереди проверки, дублировать их в модалке
            редактирования ДЗ незачем. Сам компонент TopicHomeworkReview жив —
            из него очередь берёт ReviewActions, а карточку попытки
            HomeworkAttemptDetailModal — тип TopicHomeworkReviewRow. */}
      </div>
    </div>
  )
}
