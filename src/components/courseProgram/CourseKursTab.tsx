import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, ClipboardList, Eye, Loader2, Lock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { StudentViewScope, useStaffMode } from '@/store/staffModeStore'
import { toast } from '@/store/toastStore'
import { useStudentCourseProgram, type ModuleProgress, type TopicProgress } from '@/hooks/useStudentCourseProgram'
import { useCourseHomeworkGrades } from '@/hooks/useCourseHomeworkGrades'
import { TopicSignals, type Signal } from '@/pages/StudentCoursePage'
import { lazyPage } from '@/lib/lazyPage'
import { TopicKindMark } from '@/components/courseProgram/TopicKindMark'
import { LessonFormatMark } from '@/components/courseProgram/LessonFormatMark'
import { isTopicOpen, topicClosedLabel, willOpenByDate } from '@/lib/topicAvailability'
import { formatAvg } from '@/lib/courseGrades'
import { isTimedKind } from '@/lib/timedWork'
import {
  moduleClassStats, shortDay, topicClassStats,
  type CourseHomeworkGrades, type ModuleClassStats, type TopicClassStats,
} from '@/lib/courseHomeworkJournal'
import { plural } from '@/lib/plural'

/**
 * §253. Страница темы ученика — лениво: она нужна только когда учитель открыл
 * тему, а статически тянула в чанк «Курса» (вкладка по умолчанию) весь граф
 * темы — каталог задач, рендер условий, сдачу ДЗ (~120 КБ gzip). Через
 * `lazyPage` — тот же чанк, что у маршрута ученика, и та же защита от
 * «старого хеша» после деплоя.
 */
const TopicPage = lazyPage('TopicPage', () => import('@/pages/TopicPage').then(m => ({ default: m.TopicPage })))

/**
 * §250. Вкладка курса «Курс» у учителя (макет владельца 01.10): курс так, как
 * его видит ученик, — разделы → раздел → темы → тема, — плюс строка класса.
 *
 * Чужой копии ученических экранов здесь нет: данные — тот же
 * `useStudentCourseProgram`, что у ученика, сигналы темы — его же
 * `TopicSignals`, правило открытости — `isTopicOpen`, страница темы — сама
 * ученическая `TopicPage`. Всё это работает под `<StudentViewScope>` — тем же
 * режимом, что предпросмотр §178: личное у ученика пустое, каждая запись —
 * noop, кнопки «Сдать ДЗ» и т. п. выключены. Учитель ничего не «сдаст».
 *
 * Своё у учителя — только то, чего у ученика нет: карточки разделов с цифрами
 * класса, строка «Класс: сдали X из Y · ждут проверки N · просрочили M» у темы,
 * «Открыть раньше» у закрытой темы (тот же тумблер, что в «Сроках и
 * статистике»), полоса над темой: «Проверить K» и «Редактировать тему» (то же
 * окно темы, что в программе). Цифры класса — из журнала ДЗ (PENDING_250), тот
 * же источник, что вкладка «Домашние задания»; без миграции — без строки класса.
 *
 * Где ты — в адресе (`module`, `topic`), «назад» браузера работает.
 */
export function CourseKursTab(props: {
  courseId: string
  groupId: string | null
  canEdit: boolean
  refreshKey?: number
  moduleId: string | null
  topicId: string | null
  onNavigate: (moduleId: string | null, topicId: string | null) => void
  onEditTopic: (topicId: string) => void
  onOpenTopicEarly: (topicId: string) => Promise<void>
}) {
  if (!props.groupId) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center" data-testid="kurs-no-class">
        <h2 className="text-base font-extrabold text-graphite-900">В курсе пока нет класса</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-graphite-600">
          Курс глазами ученика показывается по классу курса. Пригласите учеников — и здесь появятся разделы и темы так,
          как их видит ученик, с цифрами класса.
        </p>
      </section>
    )
  }
  return (
    <StudentViewScope>
      <KursInner {...props} groupId={props.groupId} />
    </StudentViewScope>
  )
}

function KursInner({ courseId, groupId, canEdit, refreshKey = 0, moduleId, topicId, onNavigate, onEditTopic, onOpenTopicEarly }: {
  courseId: string
  groupId: string
  canEdit: boolean
  refreshKey?: number
  moduleId: string | null
  topicId: string | null
  onNavigate: (moduleId: string | null, topicId: string | null) => void
  onEditTopic: (topicId: string) => void
  onOpenTopicEarly: (topicId: string) => Promise<void>
}) {
  const program = useStudentCourseProgram(groupId)
  const journal = useCourseHomeworkGrades(courseId, refreshKey)
  const stats = useMemo(() => (journal.data ? topicClassStats(journal.data) : null), [journal.data])
  const [opening, setOpening] = useState<string | null>(null)

  // Окно темы закрыли (`refreshKey` вырос) — тему могли открыть, поменять
  // материалы или ДЗ: перечитываем курс глазами ученика.
  const seenKey = useRef(refreshKey)
  const reload = program.reload
  useEffect(() => {
    if (seenKey.current === refreshKey) return
    seenKey.current = refreshKey
    reload()
  }, [refreshKey, reload])

  const openEarly = async (id: string) => {
    setOpening(id)
    try {
      await onOpenTopicEarly(id)
      program.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось открыть тему')
    } finally {
      setOpening(null)
    }
  }

  if (program.loading && program.modules.length === 0) {
    return <KursLoading label="Загрузка курса…" />
  }
  if (program.error) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-graphite-600" data-testid="kurs-error">
        Курс сейчас не загрузился — обновите страницу чуть позже.
      </p>
    )
  }

  const modules = program.modules
  const activeModule = moduleId ? modules.find(m => m.id === moduleId) ?? null : null
  const topicEntry = topicId
    ? modules.flatMap(m => m.topics.map((t, i) => ({ module: m, topic: t, index: i }))).find(x => x.topic.id === topicId) ?? null
    : null

  if (topicId) {
    const mod = topicEntry?.module ?? activeModule
    const s = stats?.get(topicId) ?? null
    return (
      <div className="space-y-3" data-testid="kurs-topic">
        <Crumbs items={[
          { label: 'Курс', onClick: () => onNavigate(null, null) },
          ...(mod ? [{ label: mod.title, onClick: () => onNavigate(mod.id, null) }] : []),
          { label: topicEntry ? `Тема ${topicEntry.index + 1}` : 'Тема' },
        ]} />
        <Suspense fallback={<KursLoading label="Загрузка темы…" />}>
          <TopicPage
            key={`${topicId}:${refreshKey}`}
            groupId={groupId}
            topicId={topicId}
            staffBar={<TeacherBar stats={s} topicId={topicId} canEdit={canEdit} onEdit={() => onEditTopic(topicId)} />}
          />
        </Suspense>
      </div>
    )
  }

  if (activeModule) {
    const open = activeModule.topics.filter(t => isTopicOpen(t)).length
    return (
      <div className="space-y-3" data-testid="kurs-section">
        <Crumbs items={[{ label: 'Курс', onClick: () => onNavigate(null, null) }, { label: activeModule.title }]} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-extrabold text-graphite-900 [text-wrap:balance]">{activeModule.title}</h2>
          <span className="text-sm text-graphite-600" data-testid="kurs-section-meta">
            {open} из {activeModule.topics.length} {ofTopics(activeModule.topics.length)} открыто
          </span>
        </div>
        {activeModule.topics.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-graphite-500">В разделе пока нет тем.</p>
        ) : (
          <ol className="grid gap-2.5" data-testid="kurs-topics">
            {activeModule.topics.map((t, i) => (
              <TeacherTopicRow
                key={t.id}
                topic={t}
                index={i}
                stats={stats?.get(t.id) ?? null}
                canEdit={canEdit}
                opening={opening === t.id}
                onOpen={() => onNavigate(activeModule.id, t.id)}
                onOpenEarly={() => { void openEarly(t.id) }}
              />
            ))}
          </ol>
        )}
      </div>
    )
  }

  return (
    <SectionsGrid
      modules={modules}
      groupId={groupId}
      journal={journal.data}
      stats={stats}
      onOpen={id => onNavigate(id, null)}
    />
  )
}

/** Индикатор вкладки: курс грузится — «Загрузка курса…», страница темы — «Загрузка темы…». */
function KursLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-graphite-500" data-testid="kurs-loading">
      <Loader2 size={18} className="animate-spin" aria-hidden />{label}
    </div>
  )
}

// ─── Хлебные крошки ─────────────────────────────────────────────────────────

function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Где вы в курсе" className="flex flex-wrap items-center gap-1.5 text-sm text-graphite-500" data-testid="kurs-crumbs">
      {items.map((it, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight size={13} className="shrink-0 text-graphite-300" aria-hidden />}
          {it.onClick ? (
            <button type="button" onClick={it.onClick} className="min-h-9 rounded font-bold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
              {it.label}
            </button>
          ) : (
            <span className="min-w-0 break-words" aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

// ─── Разделы ────────────────────────────────────────────────────────────────

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold'
const CHIP_NEUTRAL = 'bg-slate-100 text-graphite-600'
const CHIP_ACC = 'bg-primary-50 text-primary-700'
const CHIP_OK = 'bg-[#e3f4e8] text-[#15803d]'
const CHIP_WAIT = 'bg-[#f0eafd] text-[#6d28d9]'

/** Ближайшая дата, когда в разделе тема откроется сама. */
function nextOpenDay(mod: ModuleProgress): string | null {
  const days = mod.topics.map(t => willOpenByDate(t)).filter((d): d is string => !!d).sort()
  return days[0] ?? null
}

function SectionsGrid({ modules, groupId, journal, stats, onOpen }: {
  modules: ModuleProgress[]
  groupId: string
  journal: CourseHomeworkGrades | null
  stats: Map<string, TopicClassStats> | null
  onOpen: (moduleId: string) => void
}) {
  const { canSwitch, setMode } = useStaffMode()
  const navigate = useNavigate()
  const total = modules.reduce((n, m) => n + m.topics.length, 0)
  const open = modules.reduce((n, m) => n + m.topics.filter(t => isTopicOpen(t)).length, 0)
  const byModule = new Map(modules.map(m => [
    m.id,
    journal && stats ? moduleClassStats(journal, stats, m.topics.map(t => t.id)) : null,
  ] as const))
  const pending = [...byModule.values()].reduce((n, s) => n + (s?.pending ?? 0), 0)

  if (modules.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-graphite-500" data-testid="kurs-empty">
        В курсе пока нет разделов — ученик видит пустой курс. Программу собирают во вкладке «Сроки и статистика».
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="kurs-sections">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-graphite-600" data-testid="kurs-meta">
          {modules.length} {plural(modules.length, 'раздел', 'раздела', 'разделов')} · {open} из {total} {ofTopics(total)} открыто
          {pending > 0 && <> · ДЗ ждут проверки: <b className="font-extrabold text-[#6d28d9]">{pending}</b></>}
        </span>
        <span className="flex-1" />
        {/* Полный предпросмотр §178 (жёлтая полоса, «Мои курсы») есть только у
            admin/owner — у обычного учителя переключателя режимов нет. */}
        {canSwitch && (
          <button
            type="button"
            data-testid="kurs-preview"
            onClick={() => { setMode('student'); navigate(`/my-course/${groupId}`) }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-bold text-graphite-800 hover:border-primary-200 md:min-h-9"
          >
            <Eye size={14} aria-hidden />Смотреть как ученик
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {modules.map(m => <SectionCard key={m.id} mod={m} stats={byModule.get(m.id) ?? null} onOpen={() => onOpen(m.id)} />)}
      </div>
    </div>
  )
}

function SectionCard({ mod, stats, onOpen }: { mod: ModuleProgress; stats: ModuleClassStats | null; onOpen: () => void }) {
  const total = mod.topics.length
  const open = mod.topics.filter(t => isTopicOpen(t)).length
  const next = nextOpenDay(mod)
  const locked = total > 0 && open === 0
  const pct = total ? Math.round((open / total) * 100) : 0
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="kurs-section-card"
      data-locked={locked ? 'true' : 'false'}
      className={cn(
        'grid min-w-0 content-start gap-2.5 rounded-2xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        locked && 'opacity-70',
      )}
    >
      <h3 className="text-base font-extrabold leading-snug text-graphite-900 [text-wrap:balance]">{mod.title}</h3>
      <div className="text-[13px] text-graphite-600" data-testid="kurs-section-open">
        {open} из {total} {ofTopics(total)} открыто{next && open > 0 ? ` · дальше с ${shortDay(next)}` : ''}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <i className="block h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="kurs-section-chips">
        {stats && (stats.homeworks > 0
          ? <span className={cn(CHIP, CHIP_ACC)}>ДЗ: {stats.homeworks}</span>
          : !locked && <span className={cn(CHIP, CHIP_NEUTRAL)}>без ДЗ</span>)}
        {stats && stats.submitted > 0 && <span className={cn(CHIP, CHIP_OK)}>сдано {stats.submitted}</span>}
        {stats && stats.pending > 0 && <span className={cn(CHIP, CHIP_WAIT)}>ждут {stats.pending}</span>}
        {stats && stats.avgFive != null && <span className={cn(CHIP, CHIP_NEUTRAL)}>средний {formatAvg(stats.avgFive)}</span>}
        {locked && <span className={cn(CHIP, CHIP_NEUTRAL)}><Lock size={10} aria-hidden />{next ? `закрыт до ${shortDay(next)}` : 'закрыт'}</span>}
      </div>
    </button>
  )
}

// ─── Темы раздела ───────────────────────────────────────────────────────────

/**
 * Сигнал ДЗ у учителя — срок задания, а не «моё состояние» ученика. Источник —
 * журнал (только опубликованные ДЗ тем-уроков); пока его нет (миграция не
 * применена) — ДЗ из программы ученика (в предпросмотре — тоже только
 * опубликованные). У проверочной и контрольной сигнала нет: их срок — окно
 * работы, тип и так виден по метке.
 */
function homeworkChip(topic: TopicProgress, stats: TopicClassStats | null): Signal | null {
  if (isTimedKind(topic.kind)) return null
  if (!stats && !topic.hw_id) return null
  const due = stats ? stats.dueAt : topic.hw_due_at
  return {
    label: due ? `ДЗ до ${shortDay(due)}` : 'ДЗ',
    cls: 'bg-primary-50 text-primary-700',
    icon: <ClipboardList size={10} aria-hidden />,
  }
}

function TeacherTopicRow({ topic, index, stats, canEdit, opening, onOpen, onOpenEarly }: {
  topic: TopicProgress
  index: number
  stats: TopicClassStats | null
  canEdit: boolean
  opening: boolean
  onOpen: () => void
  onOpenEarly: () => void
}) {
  const open = isTopicOpen(topic)
  return (
    <li
      data-testid="kurs-topic-row"
      data-open={open ? 'true' : 'false'}
      className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-3 md:grid-cols-[44px_minmax(0,1fr)_auto]"
    >
      <span className={cn('grid h-9 w-9 place-items-center rounded-[10px] text-sm font-extrabold', open ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-graphite-400')}>
        {index + 1}
      </span>
      <div className="min-w-0">
        <div className={cn('font-bold leading-snug [text-wrap:balance]', open ? 'text-graphite-900' : 'text-graphite-400')}>
          {!open && <Lock size={11} className="mb-0.5 mr-1 inline text-graphite-300" aria-hidden />}
          <TopicKindMark kind={topic.kind} className="mr-1.5" />
          <LessonFormatMark format={topic.lesson_format} kind={topic.kind} className="mr-1.5" />
          {topic.title}
        </div>
        {open ? (
          // Сигналы — ученические (Видео, Задачи, «ещё N материалов»); ДЗ — срок.
          <TopicSignals topic={topic} homework={homeworkChip(topic, stats)} />
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={cn(CHIP, CHIP_NEUTRAL, 'font-semibold')} data-testid="kurs-topic-opens">{lowerFirst(topicClosedLabel(topic))}</span>
            {homeworkChip(topic, stats) && <span className={cn(CHIP, CHIP_ACC, 'font-semibold')}>{homeworkChip(topic, stats)?.label}</span>}
          </div>
        )}
        {open && stats?.issued && <ClassLine stats={stats} />}
      </div>
      <div className="col-span-2 justify-self-start md:col-span-1 md:justify-self-end">
        {open ? (
          <button
            type="button"
            onClick={onOpen}
            data-testid="kurs-topic-open"
            aria-label={`Открыть тему ${topic.title}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary-50 px-3 text-[13px] font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:min-h-9"
          >
            Открыть
          </button>
        ) : canEdit ? (
          <button
            type="button"
            onClick={onOpenEarly}
            disabled={opening}
            data-testid="kurs-topic-open-early"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-bold text-graphite-800 hover:border-primary-200 disabled:opacity-60 md:min-h-9"
          >
            {opening && <Loader2 size={13} className="animate-spin" aria-hidden />}Открыть раньше
          </button>
        ) : null}
      </div>
    </li>
  )
}

/** «из 1 темы», «из 21 темы», «из 5 тем» — после «из» родительный падеж. */
function ofTopics(n: number) {
  return n % 10 === 1 && n % 100 !== 11 ? 'темы' : 'тем'
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}

/** «Класс: сдали 17 из 24 · ждут проверки 1 · средний 4,1 · просрочили 6». */
function ClassLine({ stats }: { stats: TopicClassStats }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-dashed border-gray-200 pt-2 text-[12.5px] text-graphite-600 tabular-nums" data-testid="kurs-class-line">
      <span>Класс:</span>
      <span>сдали <b className="font-extrabold text-graphite-900">{stats.submitted}</b> из {stats.inClass}</span>
      {stats.pending > 0 && <span className="text-[#6d28d9]">ждут проверки <b className="font-extrabold">{stats.pending}</b></span>}
      {stats.avgFive != null && <span>средний {formatAvg(stats.avgFive)}</span>}
      {stats.late > 0 && <span className="font-semibold text-[#c2410c]">просрочили {stats.late}</span>}
    </div>
  )
}

// ─── Полоса учителя над темой ───────────────────────────────────────────────

function TeacherBar({ stats, topicId, canEdit, onEdit }: {
  stats: TopicClassStats | null
  topicId: string
  canEdit: boolean
  onEdit: () => void
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-primary-50 px-3 py-2.5 text-sm text-graphite-800" data-testid="kurs-teacher-bar">
      <div className="min-w-0 flex-1 basis-64">
        <span className="mr-3">Вы смотрите тему так, как её видит ученик.</span>
        {stats?.issued && (
          <span className="whitespace-nowrap" data-testid="kurs-teacher-bar-class">
            Класс: сдали ДЗ <b className="font-extrabold text-primary-700">{stats.submitted}</b> из {stats.inClass}
            {stats.pending > 0 && <> · ждут проверки <b className="font-extrabold text-primary-700">{stats.pending}</b></>}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {stats && stats.pending > 0 && (
          <Link
            to={`/homework-queue?topic=${topicId}`}
            data-testid="kurs-teacher-check"
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-bold text-graphite-800 hover:border-primary-200 md:min-h-9"
          >
            Проверить {stats.pending}
          </Link>
        )}
        <button
          type="button"
          onClick={onEdit}
          data-testid="kurs-teacher-edit"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary-600 px-3 text-[13px] font-bold text-white shadow-action hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 md:min-h-9"
        >
          {canEdit ? 'Редактировать тему' : 'Окно темы'}
        </button>
      </div>
    </div>
  )
}
