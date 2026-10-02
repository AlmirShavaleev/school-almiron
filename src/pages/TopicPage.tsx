import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Check, ChevronRight, Circle, Clock, ExternalLink, GraduationCap,
  Loader2, Lock, Play, Video, AlertCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { PREVIEW_NOOP_MESSAGE, useInStudentViewScope, usePreviewMode } from '@/store/staffModeStore'
import { isTopicOpen } from '@/lib/topicAvailability'
import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { useTopicSolutionState } from '@/hooks/useTopicSolutionState'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import { WatchedVideo } from '@/components/courseProgram/WatchedVideo'
import { useVideoWatchMarks } from '@/hooks/useVideoWatchMarks'
import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'
import { TopicTimedWorkStudent } from '@/components/courseProgram/TopicTimedWorkStudent'
import {
  TOPIC_KIND_LABEL, formatMoscowDay, formatMoscowShort, formatMoscowTime, isTimedKind, normalizeTopicKind, type TopicKind,
} from '@/lib/timedWork'
import { useTopicTimedWindow } from '@/hooks/useTimedWork'
import { TopicTestStudent } from '@/components/courseProgram/TopicTestStudent'
import { TopicTasksStudent } from '@/components/courseProgram/TopicTasksStudent'
import { useTopicTasks } from '@/hooks/useTopicTasks'
import { useTopicTraining } from '@/hooks/useTopicTraining'
import { EgeFormatMark, TopicTrainingStudent, TrainingMark } from '@/components/courseProgram/TopicTrainingStudent'
import { subtopicsForStudent } from '@/lib/training'
import { useTopicStudentVariants } from '@/components/courseProgram/TopicVariantStudent'
import {
  STUDENT_SECTION_ORDER, getVideoEmbedUrl, groupTopicSections, isMaterialSection,
  isTopicSectionVisible, sectionLabel,
  type TopicMaterialSection, type TopicSection,
} from '@/lib/topicMaterialItems'
import { useTopicSectionMarks } from '@/hooks/useTopicSectionMarks'
import { useMyTopicHomeworkState, TOPIC_HOMEWORK_STATE_LABEL } from '@/hooks/useMyTopicHomeworkState'
import { isSelfMarkable, type TopicGroupKey } from '@/lib/topicProgress'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { cn } from '@/utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopicInfo {
  id:             string
  title:          string
  order_index:    number
  available_from: string | null
  is_open:        boolean | null
  module_title:   string
  course_title:   string
  group_id:       string
  group_name:     string
  /** §240. Урок / проверочная / контрольная. */
  kind:           TopicKind
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getYouTubeEmbed(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    const v = u.searchParams.get('v')
    if (v) return `https://www.youtube.com/embed/${v}`
    if (u.pathname.startsWith('/embed/')) return url
  } catch { return null }
  return null
}

function isVimeo(url: string) {
  try { return new URL(url).hostname.includes('vimeo') } catch { return false }
}

function getVimeoEmbed(url: string): string | null {
  try {
    const id = url.match(/vimeo\.com\/(\d+)/)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : null
  } catch { return null }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * §250. Встраивание в страницу персонала (вкладка курса «Курс»): группа и тема
 * приходят пропсами, а не из адреса; своя шапка ученика («Назад», «Мои курсы ›
 * курс › раздел») не рисуется — хлебные крошки у вкладки свои, — а под
 * названием темы встаёт полоса учителя `staffBar`. Режим «как ученик» задаёт
 * `<StudentViewScope>` снаружи (`usePreviewMode()` = true), второй ветки здесь
 * нет. На маршруте ученика пропсов нет — страница та же, что была.
 */
export interface TopicPageProps {
  groupId?: string
  topicId?: string
  staffBar?: ReactNode
}

export function TopicPage({ groupId: groupIdProp, topicId: topicIdProp, staffBar }: TopicPageProps = {}) {
  const params = useParams<{ groupId: string; topicId: string }>()
  const groupId = groupIdProp ?? params.groupId
  const topicId = topicIdProp ?? params.topicId
  const embedded = staffBar !== undefined
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  // Предпросмотр глазами ученика (§178): строки `students` у владельца нет,
  // тему берём под RLS персонала; личные хуки ниже в этом режиме отдают
  // пустое состояние и ничего не пишут.
  const preview  = usePreviewMode()
  // §250: учитель на своей странице («Курс») — самоотметку не трогает вовсе.
  const staffView = useInStudentViewScope()
  // В предпросмотре обход закрытой темы не действует: ученик закрытую тему
  // не видит — и владелец в его роли не должен.
  const canBypassAvailability = !preview && !!profile?.role && ['teacher', 'curator', 'admin', 'owner'].includes(profile.role)

  const [topic,   setTopic]   = useState<TopicInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasHomework, setHasHomework] = useState(false)
  const [hasTest, setHasTest] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  /** §239. Ряд вкладок — к нему докручиваем после «Авторское решение». */
  const tabsRef = useRef<HTMLDivElement>(null)

  // Видео темы живёт в topic_material_items: плитка «Видео» в модалке
  // преподавателя пишет ссылку туда (kind='video'), старая topic_materials
  // здесь больше не читается.
  const { materials, loading: materialsLoading, reload: reloadMaterials } = useTopicMaterialItems(topicId ?? null)

  // Существует ли решение и открыто ли оно этому ученику. Сами материалы
  // решения до проверки не приходят вовсе — здесь только флаги, без путей
  // к файлам (§258: плюс «есть критерии» и «есть условие»).
  const solutionState = useTopicSolutionState(topicId ?? null)

  // Тестирования из раздела «Тесты», выданные этому ученику. Отдельным хуком, а
  // не общим запросом ниже: RPC сама решает, что ученику видно, включая
  // закрытую тему. В предпросмотре RPC не зовём: выдач у персонала нет, а
  // «есть ли задачи к уроку» решает staff-источник хука задач.
  const { variants: topicVariants } = useTopicStudentVariants(preview ? undefined : topicId ?? undefined)

  // Задачи к уроку (§162). Хук живёт здесь, а не внутри вкладки: страница
  // показывает «решено N из M» в шапке группы, и второй такой же запрос при
  // открытии урока был бы лишним.
  const topicTasks = useTopicTasks(topicId ?? undefined)

  // Тренировка (§234) — задачник по кодификатору, своя группа вкладок между
  // «Теорией» и «Уроком». Ученику скрытые подтемы база не отдаёт; фильтр ниже
  // нужен предпросмотру персонала, которому RLS отдаёт всё.
  const training = useTopicTraining(topicId ?? null)
  const trainingSubtopics = subtopicsForStudent(training.subtopics)
  const hasTraining = trainingSubtopics.length > 0

  // Самоотметки по ГРУППАМ рубрик. Персонал заходит на эту же страницу; у него
  // своей строки `students` нет, хук отдаёт пустой набор и кнопки не будет —
  // отмечать за ученика нельзя (это и есть смысл самоотметки).
  const sectionMarks = useTopicSectionMarks(topicId ?? null)
  const [markError, setMarkError] = useState<string | null>(null)

  // Состояние моей работы — словами, для ряда «Домашнее задание».
  const homeworkState = useMyTopicHomeworkState(topicId ?? null)

  // §224.2. Пробники группы — для баннера «Идёт пробник» сверху. Скриншот
  // жалобы владельца 26.09 был именно отсюда: ученик дошёл до темы, а про
  // идущий пробник тема не говорила ничего.
  const mockByGroup = useMyMockExams([groupId])
  const mockExams = (groupId && mockByGroup[groupId]) || []

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!topicId || !groupId || !profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // 1. Student record (страница ученика: без записи students темы нет).
        // В предпросмотре её и не ищем — тему персоналу отдаёт RLS.
        if (!preview) {
          const { data: student } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!student || cancelled) return
        }

        // 2. Topic + group info + homework + test (parallel)
        const [topicRes, groupRes, hwRes, testRes] = await Promise.all([
          // `*`, а не перечень: §240 добавил `kind`, и до применения миграции
          // явный столбец уронил бы всю страницу темы.
          supabase.from('topics')
            .select('*, modules(id, title, courses(id, title, subject))')
            .eq('id', topicId!).single(),
          supabase.from('groups')
            .select('id, name').eq('id', groupId!).single(),
          // §250. В предпросмотре черновик ДЗ не считается: ученику он не виден.
          preview
            ? supabase.from('topic_homework').select('id', { count: 'exact', head: true }).eq('topic_id', topicId!).eq('is_published', true)
            : supabase.from('topic_homework').select('id', { count: 'exact', head: true }).eq('topic_id', topicId!),
          supabase.from('topic_test_assignments').select('id', { count: 'exact', head: true }).eq('topic_id', topicId!),
        ])
        if (cancelled) return

        const td: any = topicRes.data
        const gd: any = groupRes.data
        if (!td) return

        setTopic({
          id:             td.id,
          title:          td.title,
          order_index:    td.order_index,
          available_from: td.available_from,
          is_open:        td.is_open ?? null,
          module_title:   td.modules?.title || '',
          course_title:   td.modules?.courses?.title || '',
          group_id:       groupId!,
          group_name:     gd?.name || '',
          kind:           normalizeTopicKind(td.kind),
        })
        setHasHomework((hwRes.count ?? 0) > 0)
        setHasTest((testRes.count ?? 0) > 0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [topicId, groupId, profile, preview])

  // §258. Окно работы по времени — для замка на «Условии» и плашки
  // предпросмотра. У урока не читается вовсе.
  const timedWindow = useTopicTimedWindow(topicId ?? null, !!topic && isTimedKind(topic.kind), preview)
  // Окно открылось, пока страница открыта: ученику база теперь отдаёт условие —
  // перечитываем материалы (вкладка «Работа» делает это сама, но ученик может
  // ждать и на вкладке «Условие»). Первый ответ — не «открытие».
  const prevOpened = useRef<boolean | null>(null)
  useEffect(() => {
    if (!timedWindow.loaded) return
    const before = prevOpened.current
    prevOpened.current = timedWindow.opened
    if (before === false && timedWindow.opened) reloadMaterials?.()
  }, [timedWindow.loaded, timedWindow.opened, reloadMaterials])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const videoMaterial = materials.find(m => m.kind === 'video') ?? null
  const videoUrl   = videoMaterial?.url || ''
  const ytEmbed    = getYouTubeEmbed(videoUrl)
  const vimeoEmbed = isVimeo(videoUrl) ? getVimeoEmbed(videoUrl) : null
  // Bunny — третьим, тем же разбором, что в карточке материала (§168).
  // Прежние две строки оставлены как есть: они и раньше работали, а вот адрес
  // Bunny здесь плеером не становился вовсе — вкладка показывала ссылку
  // «Смотреть видео» наружу. Считать просмотр у ссылки, которая уводит со
  // страницы, нечего, поэтому §204 без этой строки не заработал бы там, где
  // лежат собственные видео школы.
  const embedUrl   = ytEmbed || vimeoEmbed || getVideoEmbedUrl(videoUrl)

  // Отметка «просмотрено» на вкладке «Видео» (§204): своя строка, если она
  // уже записана. В предпросмотре не считаем и не спрашиваем.
  const countsVideoWatch = !preview
  const videoWatchMarks = useVideoWatchMarks(
    videoMaterial ? [videoMaterial.id] : [],
    countsVideoWatch,
    profile?.id ?? null,
  )
  // Сравниваем по локальной дате (YYYY-MM-DD), без сдвига в UTC.
  // В предпросмотре — полное правило открытости (`isTopicOpen`, тумблер и
  // дата): ученику закрытую тумблером тему база не отдаёт, а персоналу отдаёт,
  // и без этой проверки владелец увидел бы то, чего ученик не видит.
  const isLocked   = preview && topic
    ? !isTopicOpen(topic)
    : topic?.available_from
      ? topic.available_from.slice(0, 10) > new Date().toLocaleDateString('en-CA') && !canBypassAvailability
      : false

  // ── States ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-gray-400">
      <Loader2 size={22} className="animate-spin" />Загрузка…
    </div>
  )

  if (!topic) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
      <AlertCircle size={36} className="opacity-40" />
      <p>Тема не найдена</p>
      <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline text-sm">Назад</button>
    </div>
  )

  if (isLocked) return (
    <div className="max-w-2xl mx-auto space-y-4">
      {groupId && <MockExamAlert exams={mockExams} groupId={groupId} className="text-left" />}
      {staffBar}
      <div className="mt-12 text-center space-y-4">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto">
        <Lock size={28} className="text-gray-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-800">Тема ещё не открыта</h2>
      <p className="text-gray-500 text-sm">
        {topic.available_from && topic.is_open === null
          ? `Откроется ${new Date(topic.available_from.slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
          : 'Откроется позже'}
      </p>
      <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline text-sm">← Назад</button>
      </div>
    </div>
  )

  // ── Determine available tabs ─────────────────────────────────────────────
  // Порядок: Видео, Конспект, Теория, Задачи, Решение ДЗ, Домашнее задание, Тест

  type TabKey = 'video' | TopicMaterialSection | 'homework' | 'test' | 'training'

  const availableTabs: TabKey[] = []
  // §240. Проверочная / контрольная: главное на странице — сама работа.
  const timed = isTimedKind(topic.kind)

  // «Видео» стоит всегда, даже без видео: до перестройки на вкладки этот блок
  // с заглушкой «Видеоурок ещё не добавлен» был на странице постоянно, и его
  // исчезновение владелец прочитал как пропажу раздела. У работы по времени
  // видео — только если оно правда есть: пустая заглушка над контрольной
  // уводила бы от главного.
  if (!timed || videoMaterial) availableTabs.push('video')

  // Счёт и порядок вкладок берём из общего списка рубрик, а не перечисляем
  // руками: с §95 их семь, и перечень здесь стал бы пятой копией.
  const sectionCounts = Object.fromEntries(
    STUDENT_SECTION_ORDER.map(s => [s, materials.filter(m => m.section === s).length]),
  ) as Record<TopicMaterialSection, number>

  // §258. «Ответы и критерии» — за тем же гейтом, что решение (RLS:
  // `topic_solution_unlocked`). В предпросмотре персоналу строки отдаются все,
  // поэтому замок ставим и по ним — до PENDING_258 сервер флага не знает.
  const hasCriteria = !!solutionState.hasCriteria || (preview && sectionCounts.criteria > 0)
  const criteriaLocked = hasCriteria && !solutionState.unlocked

  // §258. «Условие» работы по времени. Ученику база отдаёт его с открытием
  // окна (или после сдачи) — закрыто ровно тогда, когда строк нет, а условие
  // есть. Персоналу строки отдаются всегда: в предпросмотре закрываем по окну,
  // как у ученика без сданной работы.
  const hasConditionRows = sectionCounts.worksheet_homework > 0
  const conditionLocked = timed && (hasConditionRows || !!solutionState.hasCondition)
    && (preview ? !timedWindow.opened : !hasConditionRows && !materialsLoading)

  for (const s of STUDENT_SECTION_ORDER) {
    // «Решение ДЗ» — особый случай: вкладка нужна и тогда, когда материалов не
    // видно из-за гейта, иначе рубрика выглядит пропавшей. С §258 так же —
    // «Ответы и критерии» и «Условие» работы по времени.
    if (s === 'solution') continue
    if (s === 'criteria' && hasCriteria) { availableTabs.push(s); continue }
    if (s === 'worksheet_homework' && conditionLocked) { availableTabs.push(s); continue }
    if (sectionCounts[s] > 0) availableTabs.push(s)
  }
  if (solutionState.hasSolution || sectionCounts.solution > 0) availableTabs.push('solution')

  if (hasHomework) availableTabs.push('homework')
  // Вкладка нужна и когда теста банка нет, а тестирование выдано.
  // Скрытие рубрики решает один переключатель в перечне (`TOPIC_SECTIONS_HIDDEN`),
  // а не условие по месту: рубрика уже однажды разъезжалась по копиям (§100).
  // В предпросмотре «выдано ли» отвечает состав задач из staff-источника.
  const hasTopicTasks = preview ? topicTasks.total > 0 : topicVariants.length > 0
  const hasAnyTest = (hasTest || hasTopicTasks) && isTopicSectionVisible('test')
  if (hasAnyTest) availableTabs.push('test')
  // Отдельным рядом, а не рубрикой перечня: у тренировки нет ни отметки, ни
  // места в «тема пройдена» (решение владельца), и в `TOPIC_SECTION_GROUPS`
  // она сдвинула бы общее определение групп темы (§121, §162).
  if (hasTraining) availableTabs.push('training')
  // §240.1. У проверочной и контрольной ученик видит только саму работу,
  // условие, решение и критерии — остальные вкладки на работе по времени
  // лишние (решение владельца 28.09).
  if (timed) {
    const keep: readonly TabKey[] = ['homework', 'worksheet_homework', 'solution', 'criteria']
    for (let i = availableTabs.length - 1; i >= 0; i -= 1) {
      if (!keep.includes(availableTabs[i])) availableTabs.splice(i, 1)
    }
  }

  // Compute active tab WITHOUT useEffect to avoid infinite loops (PROJECT_STATE §35.2):
  // if chosen tab is no longer available, switch to the first one.
  // §240: у работы по времени по умолчанию открыта сама работа.
  const defaultTab: TabKey | null = timed && availableTabs.includes('homework') ? 'homework' : availableTabs[0] ?? null
  const active: TabKey | null = chosen && availableTabs.includes(chosen as TabKey)
    ? (chosen as TabKey)
    : defaultTab

  // ── Render ───────────────────────────────────────────────────────────────────

  /**
   * Отметка группы в её же ряду.
   *
   * Три случая, и все три — про честность подписи:
   *  · «Домашнее задание» — кнопки нет ни в одном состоянии, только состояние
   *    словами: засчитывает преподаватель, приняв работу;
   *  · у персонала кнопки нет вовсе — за ученика не отмечают;
   *  · остальное — самоотметка, и подпись прямо это говорит: «Отметил сам», а
   *    не «прочитал». Автоматический учёт просмотров (§107) живёт отдельно.
   */
  function renderGroupMark(groupKey: TopicGroupKey) {
    if (groupKey === 'homework') {
      return (
        <span
          data-testid="topic-group-homework-state"
          className={cn(
            'shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium sm:ml-auto',
            homeworkState.state === 'accepted' ? 'bg-emerald-50 text-emerald-800'
              : homeworkState.state === 'returned' ? 'bg-amber-50 text-amber-800'
                : homeworkState.state === 'submitted' ? 'bg-blue-50 text-blue-700'
                  : 'bg-gray-100 text-gray-500',
          )}
        >
          {TOPIC_HOMEWORK_STATE_LABEL[homeworkState.state]}
          {homeworkState.state === 'accepted' && ' ✓'}
        </span>
      )
    }

    // Задачи к уроку отметки не имеют: группу закрывают решённые задачи.
    // Поэтому вместо кнопки — счёт, тот же, что ученик видит внутри вкладки.
    if (groupKey === 'tasks') {
      if (topicTasks.total === 0) return null
      const done = topicTasks.solved >= topicTasks.total
      return (
        <span
          data-testid="topic-group-tasks-state"
          className={cn(
            'shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium sm:ml-auto',
            done ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-500',
          )}
        >
          решено {topicTasks.solved} из {topicTasks.total}
          {done && ' ✓'}
        </span>
      )
    }

    if (!sectionMarks.canMark || !isSelfMarkable(groupKey)) return null
    const marked = sectionMarks.marks.has(groupKey)

    return (
      <button
        type="button"
        data-testid={`topic-group-mark-${groupKey}`}
        aria-pressed={marked}
        disabled={sectionMarks.loading || staffView}
        title={staffView ? PREVIEW_NOOP_MESSAGE : undefined}
        onClick={async () => {
          setMarkError(null)
          try {
            await sectionMarks.toggle(groupKey)
          } catch (e: any) {
            // Откат уже сделал хук; человеку нужна причина, иначе возврат
            // галочки читается как «глюк» (§94).
            setMarkError(e?.message ?? 'Не удалось сохранить отметку')
          }
        }}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 sm:ml-auto',
          marked
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-900',
        )}
      >
        {marked
          ? <><Check size={12} />Отметил сам</>
          : <><Circle size={12} />Отметить как сделанное</>}
      </button>
    )
  }

  /** Одна вкладка. Вынесена из разметки: рядов теперь несколько (§121). */
  function renderTab(tabKey: string) {
    let label = ''
    let count = 0
    let isLocked = false

    if (tabKey === 'video') {
      label = 'Видео'
    } else if ((STUDENT_SECTION_ORDER as readonly string[]).includes(tabKey)) {
      const s = tabKey as TopicMaterialSection
      label = sectionLabel(s, timed)
      count = sectionCounts[s]
      if (s === 'solution') isLocked = solutionState.hasSolution && !solutionState.unlocked
      if (s === 'criteria') isLocked = criteriaLocked
      if (s === 'worksheet_homework') isLocked = conditionLocked
    } else if (tabKey === 'homework') {
      label = timed ? 'Работа' : 'Домашнее задание'
    } else if (tabKey === 'test') {
      label = 'Задачи'
    }

    const isActive = active === tabKey

    return (
      <button
        key={tabKey}
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => setChosen(tabKey)}
        className={cn(
          // min-w-0 и truncate: длинная подпись («Домашнее задание») в узкой
          // колонке должна ужиматься, а не распирать сетку.
          'inline-flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:justify-start',
          isActive
            ? 'border-primary-500 text-primary-700'
            : 'border-transparent text-gray-500 hover:text-gray-800',
        )}
      >
        <span className="truncate">{label}</span>
        {isLocked && <Lock size={12} className="shrink-0" />}
        {!isLocked && count > 0 && <span className="text-xs text-gray-400">{count}</span>}
      </button>
    )
  }

  /**
   * Ряды вкладок: группы рубрик (§121) и ряд «Тренировка» сразу после
   * «Теории» — учебный маршрут владельца: теория → тренировка → формат ЕГЭ →
   * ДЗ. Нет «Теории» — ряд встаёт первым.
   */
  const sectionRows = groupTopicSections(availableTabs.filter(t => t !== 'training') as TopicSection[])
  const tabRows: Array<(typeof sectionRows)[number] | 'training'> = [...sectionRows]
  if (hasTraining) {
    const theoryIdx = sectionRows.findIndex(r => r.group?.key === 'theory')
    tabRows.splice(theoryIdx + 1, 0, 'training')
  }

  /** Ряд «Тренировка»: жёлтая пометка вместо подписи и одна вкладка. */
  function renderTrainingRow() {
    const isActive = active === 'training'
    const n = trainingSubtopics.length
    return (
      <div
        key="training"
        data-testid="topic-tab-group-training"
        className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="shrink-0 px-1 sm:w-32"><TrainingMark /></span>
        <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid="topic-tab-training"
            onClick={() => setChosen('training')}
            className={cn(
              'inline-flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:justify-start',
              isActive
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            <span className="truncate">Подтемы</span>
            <span className="text-xs text-gray-400">{n}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    // §239. На вкладке ДЗ разбор проверенной работы с 1024 идёт в две колонки
    // (страницы с рамками | задания) — в 768 px им тесно, вкладке дана ширина.
    <div className={cn('max-w-3xl space-y-6 pb-10', active === 'homework' && 'lg:max-w-5xl')}>

      {groupId && <MockExamAlert exams={mockExams} groupId={groupId} />}

      {/* ── Header ── */}
      <div>
        {!embedded && (
          <>
            <button onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-3">
              <ArrowLeft size={15} />Назад
            </button>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2 flex-wrap">
              <Link to="/my-course" className="hover:text-gray-700 transition-colors">Мои курсы</Link>
              <ChevronRight size={11} />
              <Link to={`/my-course/${groupId}`} className="hover:text-gray-700 transition-colors">{topic.course_title}</Link>
              <ChevronRight size={11} />
              <span className="text-primary-600 font-medium">{topic.module_title}</span>
            </div>
          </>
        )}
        {/* §240. Метка типа: «⏱ Контрольная работа» над названием, как в макете. */}
        {timed && (
          <span data-testid="topic-kind-badge" className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-900 px-2.5 py-1 text-xs font-extrabold text-white">
            <Clock size={12} className="shrink-0" />
            {TOPIC_KIND_LABEL[topic.kind]}
          </span>
        )}
        <h1 className="text-2xl font-bold text-gray-900">{topic.title}</h1>
        {/* shrink-0: без него иконка в 12px сжималась в чёрточку, а подпись
            группы уезжала на строку ниже (§183). */}
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1 flex-wrap">
          <GraduationCap size={12} className="shrink-0" />
          <span className="min-w-0 flex-1">{topic.group_name}</span>
        </div>
      </div>

      {/* §250. Полоса учителя — только во встроенном виде («Курс» у персонала). */}
      {staffBar}

      {/* §258. Предпросмотр работы по времени: чьи это замки и когда они
          откроются. Без строки владелец читал вкладки персонала как ученические. */}
      {preview && timed && (
        <p data-testid="topic-preview-locks" className="flex items-start gap-1.5 text-[12.5px] leading-snug text-graphite-600">
          <Lock size={13} className="mt-0.5 shrink-0 text-graphite-400" />
          <span>
            Замки показаны как у ученика: условие — {timedWindow.opensAt ? `с ${formatMoscowShort(timedWindow.opensAt)}` : 'когда будет назначено время'},
            {' '}решение и критерии — после проверки.
          </span>
        </p>
      )}

      {/* ── Tab panel ──
          Вкладки переносятся, а не скроллятся (§116), и сгруппированы по
          смыслу (§121): «Теория», «Урок», «Домашнее задание». Раньше они шли
          сплошной лентой и читались как одна куча.

          Подпись группы стоит СЛЕВА в том же ряду, а не над ним. Над вкладками
          уже заголовок темы, под ними — сам материал; отдельная строка на
          каждую подпись удвоила бы высоту шапки ровно там, где её и так много.
          На узком экране подпись встаёт над своими кнопками — как и просил
          владелец, группировка сохраняется и там.

          Состав групп живёт в общем перечне рубрик (`topicMaterialItems.ts`),
          второй копии здесь нет: перечень уже однажды разъезжался (§100). */}
      {availableTabs.length > 0 && (
        <div ref={tabsRef} role="tablist" aria-label="Разделы темы" className="scroll-mt-4 space-y-1.5 border-b border-gray-200 pb-1.5">
          {tabRows.map(row => row === 'training' ? renderTrainingRow() : (
            <div
              key={row.group?.key ?? 'other'}
              data-testid={`topic-tab-group-${row.group?.key ?? 'other'}`}
              className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3"
            >
              {row.group && (
                <span className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 sm:w-32">
                  {timed && row.group.key === 'homework' ? TOPIC_KIND_LABEL[topic.kind] : row.group.label}
                  {/* «Формат ЕГЭ» — только там, где рядом есть тренировка:
                      отличать урок не от чего, и у математики ничего не
                      меняется (§234). */}
                  {row.group.key === 'lesson' && hasTraining && <EgeFormatMark className="normal-case tracking-normal" />}
                </span>
              )}
              <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
                {row.sections.map(tabKey => renderTab(tabKey))}
              </div>

              {/*
                Отметка стоит на ГРУППЕ, а не на каждой вкладке (правка §122 по
                просмотру владельца): отмечать рубрики по одной оказалось
                неудобно. Кнопка живёт в конце того же ряда — шапка не растёт.

                «Домашнее задание» кнопки не имеет ни в одном состоянии: его
                засчитывает преподаватель, приняв работу. Вместо кнопки —
                состояние словами. Заодно это закрывает вопрос про гейт §95:
                «Решение ДЗ» лежит в этой же группе, отмечать там нечего.
              */}
              {row.group && renderGroupMark(row.group.key)}
            </div>
          ))}
        </div>
      )}

      {markError && (
        <div data-testid="topic-section-mark-error" className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {markError}
        </div>
      )}

      {/* ── Tab content ── */}
      {availableTabs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          Преподаватель ещё не добавил материалы
        </div>
      ) : active === null ? null : active === 'video' ? (
        embedUrl && videoMaterial ? (
          // Рамка та же, что была у внешнего блока: чёрная, скруглённая, с
          // тенью. Нового плеера здесь нет — тот же iframe плюс приёмник
          // событий и отметка «просмотрено» (§204).
          <WatchedVideo
            materialId={videoMaterial.id}
            embed={embedUrl}
            title="Видео темы"
            countWatch={countsVideoWatch}
            watchMark={videoWatchMarks[videoMaterial.id]}
            frameClassName="aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-md"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        ) : (
        <div className="rounded-2xl overflow-hidden bg-black shadow-md">
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-4 p-6 hover:bg-gray-900 transition-colors">
              <div className="w-14 h-14 bg-red-600 rounded-xl flex items-center justify-center shrink-0">
                <Play size={26} className="text-white ml-1" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold">Смотреть видео</div>
                <div className="text-gray-400 text-xs mt-0.5 truncate">{videoUrl}</div>
              </div>
              <ExternalLink size={16} className="text-gray-500" />
            </a>
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center gap-3 bg-gray-900">
              <Video size={36} className="text-gray-600" />
              <span className="text-gray-500 text-sm">Видеоурок ещё не добавлен</span>
            </div>
          )}
        </div>
        )
      ) : active === 'solution' && solutionState.hasSolution && !solutionState.unlocked ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-8 text-center">
          <Lock size={20} className="mx-auto text-amber-500" />
          <p className="mt-2 text-sm font-medium text-amber-900">Решение пока закрыто</p>
          <p className="mt-1 text-sm text-amber-800">
            Оно откроется, когда преподаватель проверит вашу работу. Так задание остаётся заданием.
          </p>
        </div>
      ) : active === 'criteria' && criteriaLocked ? (
        <div data-testid="topic-criteria-locked" className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-8 text-center">
          <Lock size={20} className="mx-auto text-amber-500" />
          <p className="mt-2 text-sm font-medium text-amber-900">Ответы и критерии пока закрыты</p>
          <p className="mt-1 text-sm text-amber-800">
            Откроются, когда преподаватель проверит вашу работу.
          </p>
        </div>
      ) : active === 'worksheet_homework' && conditionLocked ? (
        <div data-testid="topic-condition-locked" className="rounded-2xl border border-dashed border-graphite-300 bg-white px-4 py-8 text-center">
          <Lock size={20} className="mx-auto text-graphite-400" />
          <p className="mt-2 text-sm font-medium text-graphite-900">
            {timedWindow.opensAt && !timedWindow.opened
              ? `Условие откроется ${formatMoscowDay(timedWindow.opensAt)} в ${formatMoscowTime(timedWindow.opensAt)}`
              : timedWindow.opensAt
                ? 'Условие открывается — обновите страницу'
                : 'Время работы ещё не назначено'}
          </p>
          <p className="mt-1 text-sm text-graphite-600">
            {timedWindow.opensAt
              ? 'Оно появится в момент начала работы — до этого его не видно.'
              : 'Условие откроется в момент начала — учитель поставит дату и время.'}
          </p>
        </div>
      ) : isMaterialSection(active) ? (
        // По общему списку, а не перечислением: с §95 рубрик семь, и вкладка
        // «Решение задач» открывалась пустой — её не было в перечне (§100).
        <TopicMaterialItems topicId={topic.id} canManage={false} section={active} />
      ) : active === 'training' ? (
        <TopicTrainingStudent topicId={topic.id} subtopics={trainingSubtopics} countView={!preview} />
      ) : active === 'homework' && timed ? (
        <TopicTimedWorkStudent
          topicId={topic.id}
          kind={topic.kind}
          onOpenSection={section => {
            setChosen(section)
            window.requestAnimationFrame(() => tabsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
          }}
          // Окно открылось или работа проверена — сервер отдаёт новые
          // материалы (условие, решение, критерии): перечитываем вкладки.
          onPhaseChange={() => { reloadMaterials?.() }}
        />
      ) : active === 'homework' ? (
        <TopicHomeworkStudent
          topicId={topic.id}
          // §239. После «Принято» разбор ведёт к авторскому решению: это та
          // же вкладка «Решение ДЗ», её открывает база (`topic_solution_unlocked`).
          solution={{ unlocked: solutionState.unlocked, hasSolution: solutionState.hasSolution }}
          onOpenSolution={() => {
            setChosen('solution')
            window.requestAnimationFrame(() => tabsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
          }}
        />
      ) : active === 'test' ? (
        /* Задачи к уроку (§162) и тест из банка — разные системы. Если есть
           оба, показываем оба с подписями, а не выбираем один молча. */
        <div className="space-y-6">
          {hasTopicTasks && (
            <section>
              {hasTest && (
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Задачи к уроку</h3>
              )}
              <TopicTasksStudent tasks={topicTasks} />
            </section>
          )}
          {hasTest && (
            <section>
              {hasTopicTasks && (
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Тест по теме</h3>
              )}
              <TopicTestStudent topicId={topic.id} />
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
