import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, ExternalLink, GraduationCap,
  Loader2, Lock, Play, Video, AlertCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { useTopicSolutionState } from '@/hooks/useTopicSolutionState'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'
import { TopicTestStudent } from '@/components/courseProgram/TopicTestStudent'
import { TopicVariantStudent, useTopicStudentVariants } from '@/components/courseProgram/TopicVariantStudent'
import { TOPIC_MATERIAL_SECTION_LABELS, type TopicMaterialSection } from '@/lib/topicMaterialItems'
import { cn } from '@/utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopicInfo {
  id:             string
  title:          string
  order_index:    number
  available_from: string | null
  module_title:   string
  course_title:   string
  group_id:       string
  group_name:     string
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

export function TopicPage() {
  const { groupId, topicId } = useParams<{ groupId: string; topicId: string }>()
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const canBypassAvailability = !!profile?.role && ['teacher', 'curator', 'admin', 'owner'].includes(profile.role)

  const [topic,   setTopic]   = useState<TopicInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasHomework, setHasHomework] = useState(false)
  const [hasTest, setHasTest] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  // Видео темы живёт в topic_material_items: плитка «Видео» в модалке
  // преподавателя пишет ссылку туда (kind='video'), старая topic_materials
  // здесь больше не читается.
  const { materials } = useTopicMaterialItems(topicId ?? null)

  // Существует ли решение и открыто ли оно этому ученику. Сами материалы
  // решения до проверки не приходят вовсе — здесь только три флага, без путей
  // к файлам.
  const solutionState = useTopicSolutionState(topicId ?? null)

  // Тестирования из раздела «Тесты», выданные этому ученику. Отдельным хуком, а
  // не общим запросом ниже: RPC сама решает, что ученику видно, включая
  // закрытую тему.
  const { variants: topicVariants } = useTopicStudentVariants(topicId ?? undefined)

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!topicId || !groupId || !profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // 1. Student record (страница ученика: без записи students темы нет)
        const { data: student } = await supabase
          .from('students').select('id').eq('profile_id', profile!.id).single()
        if (!student || cancelled) return

        // 2. Topic + group info + homework + test (parallel)
        const [topicRes, groupRes, hwRes, testRes] = await Promise.all([
          supabase.from('topics')
            .select('id, title, order_index, available_from, modules(id, title, courses(id, title, subject))')
            .eq('id', topicId!).single(),
          supabase.from('groups')
            .select('id, name').eq('id', groupId!).single(),
          supabase.from('topic_homework').select('id', { count: 'exact', head: true }).eq('topic_id', topicId!),
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
          module_title:   td.modules?.title || '',
          course_title:   td.modules?.courses?.title || '',
          group_id:       groupId!,
          group_name:     gd?.name || '',
        })
        setHasHomework((hwRes.count ?? 0) > 0)
        setHasTest((testRes.count ?? 0) > 0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [topicId, groupId, profile])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const videoUrl   = materials.find(m => m.kind === 'video')?.url || ''
  const ytEmbed    = getYouTubeEmbed(videoUrl)
  const vimeoEmbed = isVimeo(videoUrl) ? getVimeoEmbed(videoUrl) : null
  const embedUrl   = ytEmbed || vimeoEmbed
  // Сравниваем по локальной дате (YYYY-MM-DD), без сдвига в UTC
  const isLocked   = topic?.available_from
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
    <div className="max-w-2xl mx-auto mt-12 text-center space-y-4">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto">
        <Lock size={28} className="text-gray-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-800">Тема ещё не открыта</h2>
      <p className="text-gray-500 text-sm">
        Откроется {new Date(topic.available_from!.slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline text-sm">← Назад</button>
    </div>
  )

  // ── Determine available tabs ─────────────────────────────────────────────
  // Порядок: Видео, Конспект, Теория, Задачи, Решение ДЗ, Домашнее задание, Тест

  type TabKey = 'video' | TopicMaterialSection | 'homework' | 'test'

  const availableTabs: TabKey[] = []

  // «Видео» стоит всегда, даже без видео: до перестройки на вкладки этот блок
  // с заглушкой «Видеоурок ещё не добавлен» был на странице постоянно, и его
  // исчезновение владелец прочитал как пропажу раздела.
  availableTabs.push('video')

  // Count materials by section
  const notesCount = materials.filter(m => m.section === 'notes').length
  const theoryCount = materials.filter(m => m.section === 'theory').length
  const tasksCount = materials.filter(m => m.section === 'tasks').length
  const solutionCount = materials.filter(m => m.section === 'solution').length

  if (notesCount > 0) availableTabs.push('notes')
  if (theoryCount > 0) availableTabs.push('theory')
  if (tasksCount > 0) availableTabs.push('tasks')

  // Solution tab available if there's a solution OR solution materials
  if (solutionState.hasSolution || solutionCount > 0) availableTabs.push('solution')

  if (hasHomework) availableTabs.push('homework')
  // Вкладка нужна и когда теста банка нет, а тестирование выдано.
  const hasAnyTest = hasTest || topicVariants.length > 0
  if (hasAnyTest) availableTabs.push('test')

  // Compute active tab WITHOUT useEffect to avoid infinite loops (PROJECT_STATE §35.2):
  // if chosen tab is no longer available, switch to the first one
  const active: TabKey | null = chosen && availableTabs.includes(chosen as TabKey)
    ? (chosen as TabKey)
    : availableTabs[0] ?? null

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-6 pb-10">

      {/* ── Header ── */}
      <div>
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
        <h1 className="text-2xl font-bold text-gray-900">{topic.title}</h1>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1 flex-wrap">
          <GraduationCap size={12} />
          <span>{topic.group_name}</span>
        </div>
      </div>

      {/* ── Tab panel ── */}
      {availableTabs.length > 0 && (
        <div role="tablist" aria-label="Разделы темы" className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
          {availableTabs.map(tabKey => {
            let label = ''
            let count = 0
            let isLocked = false

            if (tabKey === 'video') {
              label = 'Видео'
            } else if (tabKey === 'notes') {
              label = TOPIC_MATERIAL_SECTION_LABELS.notes
              count = notesCount
            } else if (tabKey === 'theory') {
              label = TOPIC_MATERIAL_SECTION_LABELS.theory
              count = theoryCount
            } else if (tabKey === 'tasks') {
              label = TOPIC_MATERIAL_SECTION_LABELS.tasks
              count = tasksCount
            } else if (tabKey === 'solution') {
              label = TOPIC_MATERIAL_SECTION_LABELS.solution
              count = solutionCount
              isLocked = solutionState.hasSolution && !solutionState.unlocked
            } else if (tabKey === 'homework') {
              label = 'Домашнее задание'
            } else if (tabKey === 'test') {
              label = 'Тест'
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
                  'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary-500 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800',
                )}
              >
                {label}
                {isLocked && <Lock size={12} />}
                {!isLocked && count > 0 && <span className="text-xs text-gray-400">{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Tab content ── */}
      {availableTabs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          Преподаватель ещё не добавил материалы
        </div>
      ) : active === null ? null : active === 'video' ? (
        <div className="rounded-2xl overflow-hidden bg-black shadow-md">
          {embedUrl ? (
            <div className="aspect-video">
              <iframe src={embedUrl} className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            </div>
          ) : videoUrl ? (
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
      ) : active === 'solution' && solutionState.hasSolution && !solutionState.unlocked ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-8 text-center">
          <Lock size={20} className="mx-auto text-amber-500" />
          <p className="mt-2 text-sm font-medium text-amber-900">Решение пока закрыто</p>
          <p className="mt-1 text-sm text-amber-800">
            Оно откроется, когда преподаватель проверит вашу работу. Так задание остаётся заданием.
          </p>
        </div>
      ) : active === 'notes' || active === 'theory' || active === 'tasks' || active === 'solution' ? (
        <TopicMaterialItems topicId={topic.id} canManage={false} section={active} />
      ) : active === 'homework' ? (
        <TopicHomeworkStudent topicId={topic.id} />
      ) : active === 'test' ? (
        /* Тест банка и тестирования — разные системы. Если есть оба, показываем
           оба с подписями, а не выбираем один молча. */
        <div className="space-y-6">
          {hasTest && (
            <section>
              {topicVariants.length > 0 && (
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Тест по теме</h3>
              )}
              <TopicTestStudent topicId={topic.id} />
            </section>
          )}
          {topicVariants.length > 0 && (
            <section>
              {hasTest && (
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Тестирования</h3>
              )}
              <TopicVariantStudent topicId={topic.id} />
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
