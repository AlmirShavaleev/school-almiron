import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, Clock, FileText, Images, Loader2, Lock, Send, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SignedImage } from '@/components/ui/SignedImage'
import { useMockExamLesson, useMockExamPing, type PhotoUploadProgress } from '@/hooks/useMockExamLesson'
import { HOMEWORK_FILE_ACCEPT, type RejectedHomeworkFile } from '@/lib/topicHomework'
import { plural } from '@/lib/plural'
import {
  MOCK_EXAMS_BUCKET, emptyAnswers, formatCountdown, lessonStatus, mskDayLong, mskTime,
  type MockLessonPhoto, type MockLessonResult, type MockLessonState, type MockLessonStatus,
} from '@/lib/mockExamLesson'
import { cn } from '@/utils/cn'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { deltaToPrevious, taskMark } from '@/lib/mockExamV3'
import { fileNameFromStoragePath } from '@/lib/storage'

/**
 * §221. Пробник в курсе глазами ученика — по макету `МАКЕТ-ОНЛАЙН-ПРОБНИКА.html`
 * (вкладки «Во время пробника» и «После проверки»).
 *
 * Таймер — только отображение: считает от часов базы (`server_now` +
 * смещение), а всё, что можно или нельзя, решает база. Когда граница окна
 * пересечена, страница перечитывает состояние у базы, а не переключается
 * сама: условие приходит только с сервера и только с начала.
 */
export function MockExamLessonPage() {
  const { groupId, examId } = useParams<{ groupId: string; examId: string }>()
  const { state, result, offset, loading, error, reload, saveAnswer, submit, uploadPhotos, removePhoto } = useMockExamLesson(examId)
  const now = useServerNow(offset)
  // §224. Монитор преподавателя: «пишет · онлайн». Пока окно открыто и вкладка видима.
  useMockExamPing(examId, state, offset)

  const status: MockLessonStatus | null = state
    ? lessonStatus({ ...state, has_work: state.submitted_at != null || state.answers.some(a => a) || state.photos.length > 0 }, now)
    : null

  // Пересекли границу окна — спросить базу заново (условие, закрытый бланк).
  const loadedStatus = useRef<MockLessonStatus | null>(null)
  useEffect(() => {
    if (!status) return
    if (loadedStatus.current == null) { loadedStatus.current = status; return }
    if (loadedStatus.current !== status) {
      loadedStatus.current = status
      reload()
    }
  }, [status, reload])

  if (loading) {
    return <div className="flex h-64 items-center justify-center gap-2 text-gray-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
  }
  if (error || !state || !status) {
    return (
      <div className="space-y-3" data-testid="mock-lesson-error">
        <BackLink groupId={groupId} />
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error || 'Пробник не найден'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-4" data-testid="mock-lesson-page" data-status={status}>
      <header>
        <BackLink groupId={groupId} />
        <h1 className="mt-1 text-2xl font-bold text-gray-900 [text-wrap:balance]">
          {state.title}{state.starts_at ? ` · ${mskDayLong(state.starts_at)}` : ''}
        </h1>
        {state.starts_at && (
          <p className="text-sm text-graphite-600">
            Урок-пробник. Открывается для всех в {mskTime(state.starts_at)}, писать до {mskTime(state.ends_at)}, загрузить фото до {mskTime(state.photos_until)}.
          </p>
        )}
      </header>

      {status === 'upcoming' && <Upcoming state={state} now={now} />}
      {status === 'open' && <TimerPanel state={state} now={now} />}
      {(status === 'submitted' || status === 'time_up') && <ClosedNote state={state} status={status} />}
      {(status === 'checking' || status === 'missed') && <CheckingNote status={status} />}
      {status === 'result' && result?.status === 'ready' && <ResultPanels result={result} state={state} groupId={groupId} />}

      {status !== 'upcoming' && status !== 'result' && state.condition_path && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-graphite-900">Условие</h2>
              <p className="text-sm text-graphite-600">Вариант открывается по ссылке, которую выдаёт сервер — только с начала пробника.</p>
            </div>
            <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={state.condition_path} sensitive className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50">
              <span data-testid="mock-lesson-condition" className="inline-flex items-center gap-1.5"><FileText size={15} />Открыть условие (PDF)</span>
            </SignedFileLink>
          </div>
        </Panel>
      )}

      {status !== 'upcoming' && status !== 'result' && (
        <AnswerSheet state={state} editable={status === 'open'} onSave={saveAnswer} onClosed={reload} />
      )}

      {status !== 'upcoming' && status !== 'result' && (
        <PhotosPanel
          state={state}
          editable={status === 'open' || status === 'submitted' || status === 'time_up'}
          onUpload={uploadPhotos}
          onRemove={removePhoto}
          onClosed={reload}
        />
      )}

      {status === 'open' && <SubmitPanel state={state} onSubmit={submit} onClosed={reload} />}
    </div>
  )
}

/** «Сейчас» по часам базы, раз в секунду. */
function useServerNow(offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    setNow(Date.now() + offset)
    const id = setInterval(() => setNow(Date.now() + offset), 1000)
    return () => clearInterval(id)
  }, [offset])
  return now
}

function BackLink({ groupId }: { groupId?: string }) {
  // §228: пришли из пункта меню «Пробники» — туда и назад.
  const fromList = (useLocation().state as { from?: string } | null)?.from === 'my-mock-exams'
  return (
    <Link to={fromList ? '/my-mock-exams' : groupId ? `/my-course/${groupId}` : '/my-course'} className="inline-flex items-center gap-1 text-[13px] text-graphite-500 hover:text-primary-700">
      <ArrowLeft size={13} />{fromList ? 'Пробники' : 'Программа курса'}
    </Link>
  )
}

function Panel({ children, className, testid }: { children: React.ReactNode; className?: string; testid?: string }) {
  return <section className={cn('rounded-xl border border-slate-200 bg-white px-4 py-4 sm:px-5', className)} data-testid={testid}>{children}</section>
}

function Upcoming({ state, now }: { state: MockLessonState; now: number }) {
  const left = new Date(state.starts_at ?? 0).getTime() - now
  return (
    <Panel testid="mock-lesson-upcoming">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-graphite-500"><Lock size={20} /></span>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-graphite-900">Откроется {mskDayLong(state.starts_at)} в {mskTime(state.starts_at)}</p>
          <p className="text-sm text-graphite-600">
            До начала <span className="font-mono tabular-nums" data-testid="mock-lesson-countdown">{left >= 24 * 3600_000 ? daysHours(left) : formatCountdown(left)}</span>.
            Условие, бланк и загрузка фото появятся в {mskTime(state.starts_at)} — для всех одновременно.
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-graphite-600">
        Писать — {durationText(minutesBetween(state.starts_at, state.ends_at))}, до {mskTime(state.ends_at)}.
        Первая часть — в бланке на сайте, вторая — на листах, потом фото сюда.
      </p>
    </Panel>
  )
}

/** «3 дня 6 ч» — когда до начала больше суток, секунды только мешают. */
function daysHours(ms: number): string {
  const d = Math.floor(ms / 86400_000)
  const h = Math.floor((ms % 86400_000) / 3600_000)
  return `${d} ${plural(d, 'день', 'дня', 'дней')}${h ? ` ${h} ч` : ''}`
}

function durationText(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h} ${plural(h, 'час', 'часа', 'часов')}` : '', m ? `${m} ${plural(m, 'минуту', 'минуты', 'минут')}` : ''].filter(Boolean).join(' ') || '0 минут'
}

function minutesBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

function TimerPanel({ state, now }: { state: MockLessonState; now: number }) {
  const starts = new Date(state.starts_at ?? 0).getTime()
  const ends = new Date(state.ends_at ?? 0).getTime()
  const left = ends - now
  const pct = Math.min(100, Math.max(0, Math.round(((now - starts) / Math.max(1, ends - starts)) * 100)))
  return (
    <Panel testid="mock-lesson-timer">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div>
          <div className="font-mono text-[34px] leading-none tabular-nums text-graphite-900" data-testid="mock-lesson-clock">{formatCountdown(left)}</div>
          <div className="mt-1 text-[13px] text-graphite-600">осталось писать · закроется в {mskTime(state.ends_at)}</div>
        </div>
        <div className="h-2 min-w-[12rem] flex-1 overflow-hidden rounded border border-slate-200 bg-slate-50" aria-hidden>
          <i className="block h-full bg-primary-600" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="mt-2.5 text-[13px] text-graphite-600">
        После {mskTime(state.ends_at)} бланк закрывается, но загрузить фото второй части можно ещё {minutesBetween(state.ends_at, state.photos_until)} минут — до {mskTime(state.photos_until)}.
      </p>
    </Panel>
  )
}

function ClosedNote({ state, status }: { state: MockLessonState; status: 'submitted' | 'time_up' }) {
  return (
    <p className={cn('rounded-r-lg border-l-[3px] px-3 py-2 text-sm', status === 'submitted' ? 'border-l-primary-600 bg-primary-50 text-graphite-800' : 'border-l-amber-500 bg-amber-50 text-amber-900')} data-testid="mock-lesson-closed" role="status">
      {status === 'submitted'
        ? <><b>Работа сдана в {mskTime(state.submitted_at)}.</b> Ответы части 1 больше не меняются. Фото можно догрузить до {mskTime(state.photos_until)}.</>
        : <><b>Время вышло в {mskTime(state.ends_at)}.</b> Бланк закрыт — что успели ввести, то и проверится. Фото второй части можно догрузить до {mskTime(state.photos_until)}.</>}
    </p>
  )
}

function CheckingNote({ status }: { status: 'checking' | 'missed' }) {
  return (
    <Panel testid="mock-lesson-checking">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-graphite-500"><Clock size={18} /></span>
        <div>
          <p className="text-lg font-semibold text-graphite-900">{status === 'checking' ? 'На проверке' : 'Работа не сдана'}</p>
          <p className="text-sm text-graphite-600">
            {status === 'checking'
              ? 'Первую часть проверит ключ, вторую — преподаватель. Результат, верные ответы и решение появятся здесь, когда преподаватель его отправит.'
              : 'В окно пробника не пришло ни одного ответа и ни одного фото.'}
          </p>
        </div>
      </div>
    </Panel>
  )
}

/** Бланк первой части: сохраняется сам на каждый ввод, по одному полю. */
function AnswerSheet({ state, editable, onSave, onClosed }: {
  state: MockLessonState
  editable: boolean
  onSave: (task: number, value: string) => Promise<{ savedAt: string | null; error: string | null }>
  onClosed: () => void
}) {
  const count = state.part1_last
  const [values, setValues] = useState<string[]>(() => Array.from({ length: count }, (_, i) => state.answers[i] ?? ''))
  const [saved, setSaved] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; text: string }>(
    state.updated_at && state.answers.some(a => a) ? { kind: 'ok', text: `Сохранено в ${mskTime(state.updated_at)}` } : { kind: 'idle', text: '' })
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  const pendingValue = useRef<Record<number, string>>({})

  async function flush(i: number) {
    clearTimeout(timers.current[i])
    delete timers.current[i]
    if (!(i in pendingValue.current)) return
    const v = pendingValue.current[i]
    delete pendingValue.current[i]
    const r = await onSave(i + 1, v)
    if (r.error) {
      setSaved({ kind: 'error', text: `Не сохранено: ${r.error}` })
      onClosed()
      return
    }
    if (Object.keys(pendingValue.current).length === 0) setSaved({ kind: 'ok', text: `Сохранено в ${mskTime(r.savedAt)}` })
  }

  // Сохраняется сам: через 0,6 с после последнего нажатия и сразу при уходе
  // из поля — чтобы «Сдать работу» не обогнал последний ответ.
  function change(i: number, v: string) {
    setValues(prev => { const n = prev.slice(); n[i] = v; return n })
    setSaved({ kind: 'saving', text: 'Сохраняю…' })
    pendingValue.current[i] = v
    clearTimeout(timers.current[i])
    timers.current[i] = setTimeout(() => { void flush(i) }, 600)
  }

  return (
    <Panel testid="mock-lesson-sheet">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-graphite-900">Бланк ответов — часть 1</h2>
          <p className="text-sm text-graphite-600">Как бланк №1 на экзамене: только ответ, без единиц и пояснений. Десятичную дробь — через запятую.</p>
        </div>
        {editable && saved.text && (
          <span role="status" data-testid="mock-lesson-saved" className={cn('text-[13px]', saved.kind === 'error' ? 'text-red-700' : saved.kind === 'ok' ? 'text-emerald-700' : 'text-graphite-500')}>{saved.text}</span>
        )}
        {!editable && <span className="inline-flex items-center gap-1 text-[13px] text-graphite-500"><Lock size={13} />бланк закрыт</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
        {values.map((v, i) => (
          <label key={i} className={cn('flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100', !editable && 'bg-slate-50')}>
            <span className="min-w-[26px] font-mono text-[13px] text-graphite-500">№{i + 1}</span>
            <input
              value={v}
              onChange={e => change(i, e.target.value)}
              onBlur={() => { void flush(i) }}
              disabled={!editable}
              inputMode="decimal"
              autoComplete="off"
              maxLength={40}
              aria-label={`Ответ на задание ${i + 1}`}
              data-testid="mock-lesson-answer"
              className="min-w-0 flex-1 border-0 bg-transparent py-1 font-mono text-base text-graphite-900 focus:outline-none disabled:text-graphite-700"
            />
          </label>
        ))}
      </div>
    </Panel>
  )
}

function PhotosPanel({ state, editable, onUpload, onRemove, onClosed }: {
  state: MockLessonState
  editable: boolean
  onUpload: (files: File[], onProgress?: (p: PhotoUploadProgress[]) => void) => Promise<{ rejected: RejectedHomeworkFile[]; error: string | null }>
  onRemove: (photo: MockLessonPhoto) => Promise<{ error: string | null }>
  onClosed: () => void
}) {
  const [progress, setProgress] = useState<PhotoUploadProgress[]>([])
  const [rejected, setRejected] = useState<RejectedHomeworkFile[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const busy = progress.length > 0
  const first = state.part1_last + 1
  const last = state.task_count

  async function pick(files: File[]) {
    if (!files.length) return
    setErr(null)
    const r = await onUpload(files, setProgress)
    setRejected(r.rejected)
    if (r.error) { setErr(r.error); onClosed() }
  }

  return (
    <Panel testid="mock-lesson-photos">
      <h2 className="text-[17px] font-semibold text-graphite-900">Часть 2 — фото решений</h2>
      <p className="mb-3 text-sm text-graphite-600">
        Задания {first}–{last}. Каждое задание с новой страницы, номер задания пишите в начале. Фотографируйте при хорошем свете, лист целиком.
        Снимайте в обычном режиме, не ProRAW: RAW-снимки (.dng) не откроются у преподавателя.
      </p>
      {editable && (
        <div
          className={cn('rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm text-graphite-600', drag ? 'border-primary-500 bg-primary-50' : 'border-slate-300')}
          onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={async e => { e.preventDefault(); setDrag(false); if (!busy) await pick(Array.from(e.dataTransfer.files ?? [])) }}
          data-testid="mock-lesson-drop"
        >
          {busy ? (
            <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />
              Загружаю {progress.map(p => `${p.percent}%`).join(' · ')}
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span>Перетащите фото сюда или</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-graphite-800 hover:bg-primary-50">
                <Upload size={14} />выберите файлы
                <input type="file" multiple accept={HOMEWORK_FILE_ACCEPT} className="hidden" data-testid="mock-lesson-file-input"
                  onChange={async e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; await pick(f) }} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-graphite-800 hover:bg-primary-50 sm:hidden">
                <Camera size={14} />снять
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={async e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; await pick(f) }} />
              </label>
            </div>
          )}
        </div>
      )}
      {!editable && <p className="inline-flex items-center gap-1 text-[13px] text-graphite-500"><Lock size={13} />Загрузка фото закрыта в {mskTime(state.photos_until)}.</p>}
      {rejected.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="mock-lesson-rejected">
          {rejected.map((r, i) => <li key={i}><b>{r.file.name}</b> — {r.problem}</li>)}
        </ul>
      )}
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{err}</p>}
      {state.photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5" data-testid="mock-lesson-thumbs">
          {state.photos.map((p, i) => (
            <figure key={p.id} className="relative w-[92px]">
              <SignedImage bucket={MOCK_EXAMS_BUCKET} path={p.storage_path} alt={`Страница ${i + 1}`} className="h-[120px] w-[92px] rounded border border-slate-200 object-cover" />
              <figcaption className="mt-0.5 truncate text-[11px] text-graphite-500">стр. {i + 1}</figcaption>
              {editable && (
                <button type="button" aria-label={`Убрать страницу ${i + 1}`} disabled={busy}
                  onClick={async () => { const r = await onRemove(p); if (r.error) { setErr(r.error); onClosed() } }}
                  className="absolute right-1 top-1 rounded bg-white/90 p-1 text-graphite-600 shadow hover:text-red-700">
                  <Trash2 size={13} />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** Сдать — с подтверждением на странице, без `confirm()`. */
function SubmitPanel({ state, onSubmit, onClosed }: {
  state: MockLessonState
  onSubmit: () => Promise<{ error: string | null }>
  onClosed: () => void
}) {
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const empty = useMemo(() => emptyAnswers(state.answers, state.part1_last), [state.answers, state.part1_last])
  const filled = state.part1_last - empty.length

  async function go() {
    setBusy(true)
    const r = await onSubmit()
    setBusy(false)
    if (r.error) { setErr(r.error); onClosed() }
  }

  return (
    <>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-graphite-600">Сдать можно раньше времени. После сдачи ответы не меняются, но фото можно догрузить до {mskTime(state.photos_until)}.</p>
        <Button onClick={() => { setAsk(true); setErr(null) }} disabled={ask} data-testid="mock-lesson-submit"><Send size={15} />Сдать работу</Button>
      </Panel>
      {ask && (
        <div className="rounded-r-lg border-l-[3px] border-l-primary-600 bg-primary-50 px-3 py-2.5 text-sm text-graphite-800" role="alertdialog" aria-labelledby="mock-submit-title" data-testid="mock-lesson-confirm">
          <p><b id="mock-submit-title">Сдать сейчас?</b>{' '}
            Заполнено {filled} {plural(filled, 'ответ', 'ответа', 'ответов')} из {state.part1_last}, загружено {state.photos.length} фото.
            {empty.length > 0 && ` ${empty.length === 1 ? 'Пустой ответ' : 'Пустые ответы'} ${empty.map(n => `№${n}`).join(', ')} ${empty.length === 1 ? 'засчитается как нерешённый' : 'засчитаются как нерешённые'}.`}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={go} loading={busy} data-testid="mock-lesson-submit-yes">Сдать</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsk(false)} disabled={busy}>Вернуться</Button>
          </div>
          {err && <p className="mt-2 text-red-800" role="alert">{err}</p>}
        </div>
      )}
    </>
  )
}

/**
 * §228. Результат у ученика — по макету v3 (экран 4, справа): крупно итог
 * (тестовый, если есть таблица перевода), строка «первичный · части», разница
 * с прошлым пробником той же группы; «По номерам» — метками `VerdictMark`
 * (форма, не только цвет); ниже ответы первой части рядом с верными и баллы
 * второй; файлы — решение и свои фото (пометок на фото в этом шаге нет).
 */
function ResultPanels({ result, state, groupId }: { result: Extract<MockLessonResult, { status: 'ready' }>; state: MockLessonState; groupId?: string }) {
  const part1 = result.tasks.filter(t => t.n <= result.part1_last)
  const part2 = result.tasks.filter(t => t.n > result.part1_last)
  const p1max = part1.reduce((a, t) => a + t.max, 0)
  const p2max = part2.reduce((a, t) => a + t.max, 0)
  const primaryMax = p1max + p2max
  const hasScale = result.max_score != null && result.max_score !== primaryMax
  const mine = useMyMockExams(groupId ? [groupId] : [])
  const list = (groupId ? mine[groupId] ?? [] : []).map(e => ({ ...e, group: groupId! }))
  const delta = deltaToPrevious(list, state.id)
  const prevTitle = delta != null
    ? list.filter(e => e.id !== state.id && e.score != null && e.starts_at < (state.starts_at ?? '')).sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0]?.title
    : null
  return (
    <div className="space-y-3.5" data-testid="mock-lesson-result">
      <Panel>
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[34px] font-extrabold leading-none tracking-[-.02em] text-graphite-900" data-testid="mock-lesson-big">{hasScale ? result.score ?? '—' : result.primary_score ?? '—'}</span>
          <span className="text-graphite-500">{hasScale ? `тестовых из ${result.max_score}` : `первичных из ${primaryMax}`}</span>
        </div>
        <p className="mt-2 text-sm text-graphite-900" data-testid="mock-lesson-primary">
          Первичный {result.primary_score ?? '—'} из {primaryMax} · часть 1: {result.part1_score ?? '—'} из {p1max} · часть 2: {result.part2_score ?? '—'} из {p2max}
        </p>
        {delta != null && delta !== 0 && (
          <p className={cn('mt-1 text-sm font-bold', delta > 0 ? 'text-verdict-ok-ink' : 'text-verdict-bad-ink')} data-testid="mock-lesson-delta">
            {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`} к {prevTitle ? `«${prevTitle}»` : 'прошлому пробнику'}
          </p>
        )}
        <p className="mt-2 text-[13px] text-graphite-500">
          Проверил преподаватель {mskDayLong(result.notified_at)}.
          {!hasScale && ' Тестовый балл появится, когда будет внесена таблица перевода на этот год.'}
        </p>
      </Panel>
      <Panel>
        <h3 className="mb-2.5 text-[15px] font-bold text-graphite-900">По номерам</h3>
        <div className="grid grid-cols-10 gap-x-1 gap-y-1.5 text-center" data-testid="mock-lesson-marks">
          {result.tasks.map(t => (
            <div key={t.n} className="flex flex-col items-center gap-0.5 text-[13px] text-graphite-500 sm:text-xs" data-mark={taskMark(t.points, t.max)}>
              {t.n}
              <VerdictMark state={t.points == null ? 'none' : taskMark(t.points, t.max)} size={20} label={`№${t.n}: ${t.points ?? '—'} из ${t.max}`} />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-3.5 text-[13px] text-graphite-500 sm:text-xs">
          <span className="inline-flex items-center gap-1.5"><VerdictMark state="ok" size={16} label={null} />полный</span>
          <span className="inline-flex items-center gap-1.5"><VerdictMark state="part" size={16} label={null} />частично</span>
          <span className="inline-flex items-center gap-1.5"><VerdictMark state="bad" size={16} label={null} />0</span>
        </div>
      </Panel>
      <div className="grid gap-3.5 md:grid-cols-2">
        <Panel>
          <h3 className="mb-2 text-[15px] font-bold text-graphite-900">Часть 1 — ответы</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="mock-lesson-part1">
              <thead><tr className="text-left text-xs font-semibold uppercase tracking-[.04em] text-graphite-500">
                <th className="border-b border-graphite-200 px-2 py-1.5">№</th>
                <th className="border-b border-graphite-200 px-2 py-1.5">Твой ответ</th>
                <th className="border-b border-graphite-200 px-2 py-1.5">Верный</th>
                <th className="border-b border-graphite-200 px-2 py-1.5 text-right">Балл</th>
              </tr></thead>
              <tbody>
                {part1.map(t => (
                  <tr key={t.n}>
                    <td className="border-b border-graphite-100 px-2 py-1.5">{t.n}</td>
                    <td className="border-b border-graphite-100 px-2 py-1.5 font-mono">{t.answer || '—'}</td>
                    <td className="border-b border-graphite-100 px-2 py-1.5 font-mono">{t.correct ?? '—'}</td>
                    <td className="border-b border-graphite-100 px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1.5 font-mono">{t.points ?? '—'}<VerdictMark state={t.points == null ? 'none' : taskMark(t.points, t.max)} size={14} label={null} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <h3 className="mb-2 text-[15px] font-bold text-graphite-900">Часть 2</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="mock-lesson-part2">
              <thead><tr className="text-left text-xs font-semibold uppercase tracking-[.04em] text-graphite-500">
                <th className="border-b border-graphite-200 px-2 py-1.5">№</th>
                <th className="border-b border-graphite-200 px-2 py-1.5 text-right">Балл</th>
                <th className="border-b border-graphite-200 px-2 py-1.5 text-right">Максимум</th>
              </tr></thead>
              <tbody>
                {part2.map(t => (
                  <tr key={t.n}>
                    <td className="border-b border-graphite-100 px-2 py-1.5">{t.n}</td>
                    <td className="border-b border-graphite-100 px-2 py-1.5 text-right font-mono">{t.points ?? '—'}</td>
                    <td className="border-b border-graphite-100 px-2 py-1.5 text-right font-mono">{t.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel>
        <h3 className="mb-2 text-[15px] font-bold text-graphite-900">Файлы</h3>
        <div className="flex flex-col gap-2">
          {result.solution_path ? (
            <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={result.solution_path} sensitive className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
              <span data-testid="mock-lesson-solution" className="inline-flex items-center gap-1.5"><FileText size={15} />Решение · {fileNameFromStoragePath(result.solution_path).replace(/^\d+_/, '')}</span>
            </SignedFileLink>
          ) : <span className="text-sm text-graphite-500">Решение преподаватель ещё не загрузил.</span>}
          {state.photos.length > 0 && (
            <div>
              <p className="mb-1.5 inline-flex items-center gap-1 text-sm font-semibold text-graphite-900"><Images size={14} />Мои фото · {state.photos.length}</p>
              <div className="flex flex-wrap gap-2">
                {state.photos.map((p, i) => (
                  <SignedFileLink key={p.id} bucket={MOCK_EXAMS_BUCKET} url={p.storage_path} className="block">
                    <SignedImage bucket={MOCK_EXAMS_BUCKET} path={p.storage_path} alt={`Страница ${i + 1}`} className="h-[80px] w-[62px] rounded border border-graphite-200 object-cover" />
                  </SignedFileLink>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
