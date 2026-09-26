import { useState } from 'react'
import { RefreshCw, Play, EyeOff, Activity, AlertTriangle, KeyRound } from 'lucide-react'
import { cn } from '@/utils/cn'
import { plural } from '@/lib/plural'
import type { VideoLibraryStats, VideoStatsData } from '@/hooks/useVideoStats'
import { useVideoHeatmap, useVideoStats } from '@/hooks/useVideoStats'
import {
  attentionHalvesAt, formatClock, heatmapSeries, missingLessons, neverWatched,
  toMinutes, watchedLessons, watchedShare,
  type LessonSort, type VideoLesson,
} from '@/lib/videoStats'

/**
 * Вкладка «Видео» — как смотрят видеоуроки, по данным Bunny Stream.
 *
 * Отдельной вкладкой рядом с «Сайт», а не блоком в «Обзоре»: это третий
 * независимый источник чисел (школьные срезы §107, посещения Vercel §135,
 * просмотры Bunny), и на одном экране их спутают.
 *
 * ГЛАВНАЯ ОГОВОРКА, и она стоит первой строкой на экране: **Bunny не знает,
 * кто смотрел.** Ссылки на видео у нас без токенов (решение владельца при
 * импорте), для Bunny все зрители безымянные. Поэтому здесь «просмотры», а
 * не «ученики посмотрели»: подмена этих слов превратила бы отчёт в ответ на
 * вопрос, которого он не знает.
 *
 * ВТОРАЯ ОГОВОРКА: строка = ВИДЕО, а не тема курса. Курсы копировались из
 * шаблонов, поэтому один ролик стоит в двух-трёх курсах (302 записи на 127
 * роликов). Bunny считает его один раз — строка на каждую запись показала бы
 * одни и те же просмотры трижды.
 */

interface VideoStatsProps extends VideoStatsData {
  loading: boolean
  error:   string | null
  reload:  () => void
}

/**
 * Вкладка целиком: сама берёт данные и сама рисует.
 *
 * Хук живёт ЗДЕСЬ, а не на странице админки, намеренно. Поднятый на страницу
 * (как `useVercelAnalytics`), он ходил бы в функцию при каждом открытии
 * админки — даже у того, кто на эту вкладку не заглядывает. Смонтированный
 * вместе со вкладкой, он стучится только когда вкладку открыли.
 */
export function VideoStatsTab() {
  const stats = useVideoStats()
  return <VideoStats {...stats} />
}

/**
 * §232. Библиотек две — математика и физика, у каждой свой ключ Bunny. Они
 * показываются ПЕРЕКЛЮЧАТЕЛЕМ, а не одной общей таблицей: плитки «за 30 дней»
 * приходят из статистики библиотеки целиком, и сложенные вместе они уже не
 * отвечали бы на вопрос «как смотрят физику». Отказ одной библиотеки виден
 * только на её вкладке; «ключ не задан» — спокойная пометка, а не красная
 * ошибка: это «ещё не подключили», а не поломка.
 */
export function VideoStats(props: VideoStatsProps) {
  const { libraries, unknownLibraries, loading, error, reload } = props

  const [picked, setPicked] = useState<string | null>(null)
  const heat = useVideoHeatmap()

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        Загружаем статистику просмотров…
      </div>
    )
  }

  if (error) {
    // Отказ ВСЕЙ функции (нет прав, сеть). Отказы Bunny по библиотеке —
    // ниже, на вкладке этой библиотеки. Нули здесь показывать нельзя: они
    // читаются как «никто не смотрел».
    return (
      <div
        data-testid="video-stats-error"
        role="alert"
        className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
      >
        {error}
      </div>
    )
  }

  const current = libraries.find(l => l.id === picked)
    ?? libraries.find(l => l.primary)
    ?? libraries[0]
    ?? null

  const choose = (id: string) => {
    if (id === current?.id) return
    heat.clear()
    setPicked(id)
  }

  return (
    <div className="space-y-4" data-testid="video-stats">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">
            Просмотры видеоуроков по данным Bunny.
          </p>
          {current?.status === 'ok' && (
            <p className="mt-1 text-xs text-slate-400" data-testid="video-stats-freshness">
              {current.fetchedAt ? `Данные на ${formatTime(current.fetchedAt)}` : 'Время получения неизвестно'}
              {current.fromCache && ' · из кэша'}
              {current.libraryTotal > 0 && ` · в библиотеке ${current.libraryTotal} роликов`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-slate-500 transition-colors hover:text-graphite-900"
        >
          <RefreshCw size={14} />Обновить
        </button>
      </header>

      {/* Оговорка про безымянность — не мелким шрифтом внизу, а до чисел. */}
      <p
        data-testid="video-stats-anonymity"
        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"
      >
        Bunny не знает, кто смотрел: ссылки на видео у нас без токенов, для него все зрители
        безымянные. Это просмотры всех, у кого была ссылка, а не «ученики посмотрели».
        Один урок стоит в нескольких курсах — Bunny считает его один раз, поэтому строка одна,
        а курсы перечислены.
      </p>

      {libraries.length > 1 && current && (
        <LibrarySwitch libraries={libraries} currentId={current.id} onPick={choose} />
      )}

      {unknownLibraries.length > 0 && (
        <p
          data-testid="video-stats-unknown-libraries"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500"
        >
          {unknownLibraries.map(u => `${u.videos} ${plural(u.videos, 'ролик', 'ролика', 'роликов')} из библиотеки ${u.libraryId}`).join(', ')}
          {' '}привязаны к темам, но статистика эту библиотеку не знает — её номера и ключа нет в
          переменных проекта.
        </p>
      )}

      {!current ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          Функция не вернула ни одной библиотеки.
        </p>
      ) : current.status === 'not_configured' ? (
        <NotConfigured library={current} />
      ) : current.status === 'error' ? (
        <div
          data-testid="video-library-error"
          role="alert"
          className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
        >
          {current.message}
        </div>
      ) : (
        <LibraryPanel library={current} heat={heat} />
      )}
    </div>
  )
}

/**
 * «Математика / Физика». Состояние библиотеки видно прямо на кнопке —
 * серой подписью, без красного: чтобы отказ физики не нужно было искать
 * кликом, но и чтобы он не кричал поверх рабочей математики.
 */
function LibrarySwitch({
  libraries, currentId, onPick,
}: {
  libraries: VideoLibraryStats[]
  currentId: string
  onPick: (id: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Библиотека видео"
      data-testid="video-library-switch"
      className="flex w-full gap-1 rounded-xl bg-slate-100 p-1 sm:w-auto sm:inline-flex"
    >
      {libraries.map(lib => {
        const active = lib.id === currentId
        const note = lib.status === 'not_configured' ? 'не подключена'
          : lib.status === 'error' ? 'ошибка'
            : null
        return (
          <button
            key={lib.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(lib.id)}
            className={cn(
              // На телефоне пометка встаёт под названием, а не переносится по слову.
              'flex min-h-11 flex-1 flex-col items-center justify-center rounded-lg px-4 py-1 text-sm leading-tight transition-colors sm:flex-none sm:flex-row sm:gap-1.5',
              active ? 'bg-white font-semibold text-graphite-900 shadow-sm' : 'text-slate-500 hover:text-graphite-900',
            )}
          >
            {lib.label}
            {note && (
              <span className="whitespace-nowrap text-xs font-normal text-slate-400">
                <span className="hidden sm:inline">· </span>{note}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Дополнительной библиотеке не дали ключ. Это не поломка — функция работает,
 * математика считается, — поэтому серым, без `role="alert"`. Число роликов,
 * которые ждут ключа, посчитано по адресам материалов: видно, что видео
 * физики уже узнаются, и после ключа статистика просто появится.
 */
function NotConfigured({ library }: { library: VideoLibraryStats }) {
  return (
    <div
      data-testid="video-library-not-configured"
      className="rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-slate-400"><KeyRound size={18} /></span>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold text-graphite-950">
            {library.label}: статистика ещё не подключена
          </h3>
          <p className="text-sm text-slate-500">{library.message}</p>
          {library.attachedVideos > 0 && (
            <p className="text-xs text-slate-400" data-testid="video-library-waiting">
              К темам уже привязано {library.attachedVideos} {plural(library.attachedVideos, 'ролик', 'ролика', 'роликов')} из
              библиотеки {library.id} — их просмотры появятся здесь сразу после подключения.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Числа одной библиотеки — то, что до §232 было всей вкладкой. */
function LibraryPanel({
  library, heat,
}: {
  library: VideoLibraryStats
  heat: ReturnType<typeof useVideoHeatmap>
}) {
  const { lessons, unattachedInLibrary, period, throttled, partial } = library
  const [sort, setSort] = useState<LessonSort>('views')

  const watched = watchedLessons(lessons, sort)
  const untouched = neverWatched(lessons)
  const missing = missingLessons(lessons)

  return (
    <div className="space-y-4" data-testid={`video-library-${library.id}`}>
      {throttled && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Обновляли только что — показаны прежние данные. Bunny опрашивается не чаще раза в минуту.
        </p>
      )}
      {partial && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Часть запросов к Bunny не прошла — числа ниже неполные.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          title={`Просмотров за ${period?.days ?? 30} дн.`}
          value={period ? String(period.views) : '—'}
        />
        <Stat
          title={`Отсмотрено за ${period?.days ?? 30} дн.`}
          value={period ? `${toMinutes(period.watchSec)} мин` : '—'}
        />
        <Stat title="Уроков смотрели" value={`${watched.length} из ${lessons.length}`} />
        <Stat title="Не смотрел никто" value={String(untouched.length)} />
      </div>

      <WatchedBlock
        lessons={watched}
        sort={sort}
        onSort={setSort}
        selectedId={heat.videoId}
        onSelect={id => (heat.videoId === id ? heat.clear() : heat.load(id, library.id))}
      />

      {heat.videoId && (
        <HeatmapBlock
          lesson={lessons.find(l => l.videoId === heat.videoId) ?? null}
          heatmap={heat.heatmap}
          loading={heat.loading}
          error={heat.error}
        />
      )}

      <UntouchedBlock lessons={untouched} />

      {missing.length > 0 && <MissingBlock lessons={missing} />}

      {unattachedInLibrary > 0 && (
        <p
          data-testid="video-stats-unattached"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500"
        >
          В библиотеке Bunny ещё {unattachedInLibrary} роликов, не привязанных ни к одной теме.
          Либо импорт до них не дошёл, либо они запасные — но ученикам они не видны.
        </p>
      )}
    </div>
  )
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-graphite-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{title}</div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">{children}</div>
}

function Head({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-sm font-semibold text-graphite-950">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** Перечень курсов урока. Шаблоны сюда не попадают — там никто не учится. */
function Courses({ lesson }: { lesson: VideoLesson }) {
  if (lesson.onlyInTemplate) {
    return <span className="text-xs text-slate-400">только в шаблоне</span>
  }
  return <span className="text-xs text-slate-400">{lesson.courses.join(' · ')}</span>
}

function WatchedBlock({
  lessons, sort, onSort, selectedId, onSelect,
}: {
  lessons: VideoLesson[]
  sort: LessonSort
  onSort: (s: LessonSort) => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <Shell>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <Head
          icon={<Play size={16} />}
          title="Уроки, которые смотрели"
          hint="За всё время: просмотры по ролику Bunny не режутся по датам. Числа за период — в плитках выше."
        />
        {/* Два топа владельца — одной таблицей с переключателем: данные те же,
            вопрос разный («сколько раз открыли» против «сколько высидели»). */}
        <div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1">
          <SortButton active={sort === 'views'} onClick={() => onSort('views')}>
            по просмотрам
          </SortButton>
          <SortButton active={sort === 'minutes'} onClick={() => onSort('minutes')}>
            по минутам
          </SortButton>
        </div>
      </div>

      {lessons.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Ни один видеоурок пока не открывали.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2 font-normal">Урок</th>
                <th className="pb-2 text-right font-normal">Просмотры</th>
                <th className="pb-2 text-right font-normal">Минуты</th>
                <th className="pb-2 text-right font-normal">Досмотр</th>
                <th className="pb-2 text-right font-normal">Длина</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lessons.map(lesson => {
                const share = watchedShare(lesson.avgWatchSec, lesson.lengthSec)
                return (
                  <tr
                    key={lesson.videoId}
                    onClick={() => onSelect(lesson.videoId)}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-slate-50',
                      selectedId === lesson.videoId && 'bg-slate-50',
                    )}
                  >
                    <td className="py-2 pr-3">
                      <div className="truncate text-graphite-900">{lesson.topicTitle}</div>
                      <Courses lesson={lesson} />
                    </td>
                    <td className="py-2 text-right tabular-nums text-graphite-900">{lesson.views}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500">
                      {toMinutes(lesson.totalWatchSec)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-500">
                      {share === null ? '—' : `${Math.round(share * 100)} %`}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-400">
                      {formatClock(lesson.lengthSec)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Нажмите на строку — покажем, на какой минуте внимание падает.
          </p>
        </div>
      )}
    </Shell>
  )
}

function SortButton({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1 text-xs transition-colors',
        active ? 'bg-white text-graphite-900 shadow-sm' : 'text-slate-500 hover:text-graphite-900',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Тепловая карта выбранного урока.
 *
 * Подпись про относительность обязательна: Bunny нормирует карту (100 — самый
 * смотримый отрезок), поэтому она отвечает на вопрос «где внимание», а не
 * «сколько человек досмотрело». Абсолютное число рядом — доля досмотра.
 */
function HeatmapBlock({
  lesson, heatmap, loading, error,
}: {
  lesson: VideoLesson | null
  heatmap: Record<string, number> | null
  loading: boolean
  error: string | null
}) {
  const points = heatmapSeries(heatmap, lesson?.lengthSec ?? 0)
  const halves = attentionHalvesAt(points)
  const share = lesson ? watchedShare(lesson.avgWatchSec, lesson.lengthSec) : null

  return (
    <Shell>
      <Head
        icon={<Activity size={16} />}
        title={lesson ? `Внимание: ${lesson.topicTitle}` : 'Внимание по минутам'}
        hint="Относительное внимание, 100 — самый смотримый отрезок ролика. Это не «сколько человек досмотрело»."
      />

      {loading && <p className="py-4 text-center text-sm text-slate-400">Загружаем тепловую карту…</p>}

      {error && (
        <p role="alert" className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          {error}
        </p>
      )}

      {!loading && !error && points.length === 0 && (
        <p className="py-4 text-center text-sm text-slate-400">
          Bunny не вернул тепловую карту для этого ролика.
        </p>
      )}

      {!loading && !error && points.length > 0 && (
        <>
          {/* Отрезки без внимания рисуются нулевой полоской, а не пропускаются:
              Bunny не присылает пустые отрезки вовсе, и без заполнения график
              соединил бы соседей линией поверх провала. */}
          <div className="flex h-24 items-end gap-px" role="img" aria-label="Внимание по ходу ролика">
            {points.map(p => (
              <div
                key={p.index}
                title={`${formatClock(p.atSec)} — ${p.value}`}
                className={cn('flex-1 rounded-t-sm', p.value > 0 ? 'bg-primary-500' : 'bg-slate-100')}
                style={{ height: `${p.value > 0 ? Math.max(p.value, 4) : 3}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
            <span data-testid="video-heatmap-halves">
              {halves
                ? `Внимание падает вдвое к ${formatClock(halves.atSec)}`
                : 'Внимание за ролик вдвое не падает'}
            </span>
            {share !== null && (
              <span>В среднем досматривают {Math.round(share * 100)} % ролика</span>
            )}
          </div>
        </>
      )}
    </Shell>
  )
}

/**
 * Уроки, которых не открывал никто. Владелец просил именно это — сигнал не
 * хуже топа. Список длинный по построению, поэтому свёрнут: разворачивается
 * по кнопке, а не занимает три экрана.
 */
function UntouchedBlock({ lessons }: { lessons: VideoLesson[] }) {
  const [open, setOpen] = useState(false)

  return (
    <Shell>
      <Head
        icon={<EyeOff size={16} />}
        title={`Не смотрел никто — ${lessons.length}`}
        hint="Ролик привязан к теме, но его ни разу не открывали."
      />
      {lessons.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Такие уроки есть у всех — но не здесь.</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-xs text-primary-600 hover:text-primary-700"
          >
            {open ? 'Свернуть список' : 'Показать список'}
          </button>
          {open && (
            <ul className="mt-2 divide-y divide-slate-50" data-testid="video-untouched-list">
              {lessons.map(lesson => (
                <li key={lesson.videoId} className="py-2">
                  <div className="truncate text-sm text-graphite-900">{lesson.topicTitle}</div>
                  <Courses lesson={lesson} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Shell>
  )
}

/**
 * Ролик привязан к теме, но в библиотеке его больше нет.
 *
 * Отдельным блоком, а не нулём в общей таблице: ноль читался бы как «никто не
 * смотрел», тогда как смотреть тут уже нечего — у ученика на теме пустой
 * плеер.
 */
function MissingBlock({ lessons }: { lessons: VideoLesson[] }) {
  return (
    <Shell>
      <Head
        icon={<AlertTriangle size={16} />}
        title={`Нет в библиотеке Bunny — ${lessons.length}`}
        hint="Тема ссылается на ролик, которого в библиотеке уже нет. У ученика на этой теме пустой плеер."
      />
      <ul className="divide-y divide-slate-50" data-testid="video-missing-list">
        {lessons.map(lesson => (
          <li key={lesson.videoId} className="py-2">
            <div className="truncate text-sm text-graphite-900">{lesson.topicTitle}</div>
            <Courses lesson={lesson} />
          </li>
        ))}
      </ul>
    </Shell>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
