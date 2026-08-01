import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, ExternalLink, GraduationCap,
  Loader2, Lock, Play, Video, AlertCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { acceptedAttempt, activeAttempt } from '@/lib/topicHomework'
import { TopicMaterialItems, type SolutionLock } from '@/components/courseProgram/TopicMaterialItems'
import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'
import { TopicTestStudent } from '@/components/courseProgram/TopicTestStudent'

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

  // Видео темы живёт в topic_material_items: плитка «Видео» в модалке
  // преподавателя пишет ссылку туда (kind='video'), старая topic_materials
  // здесь больше не читается.
  const { materials } = useTopicMaterialItems(topicId ?? null)

  // ДЗ темы нужно здесь только ради замка на рубрике «Решение ДЗ»: пока работа
  // не сдана и не принята, разбор ученику не показываем.
  const { homework, attempts, loading: hwLoading } = useTopicHomework(topicId ?? null)

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

        // 2. Topic + group info (parallel)
        const [topicRes, groupRes] = await Promise.all([
          supabase.from('topics')
            .select('id, title, order_index, available_from, modules(id, title, courses(id, title, subject))')
            .eq('id', topicId!).single(),
          supabase.from('groups')
            .select('id, name').eq('id', groupId!).single(),
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
  // ── Замок на «Решение ДЗ» ────────────────────────────────────────────────
  // Правило: разбор открывается, когда преподаватель принял работу
  // (статус попытки 'accepted'). Если к теме вообще не привязано ДЗ, сдавать
  // нечего — иначе рубрика осталась бы закрытой навсегда.
  //
  // Замок косметический: файл лежит в общем бакете и достаётся подписанной
  // ссылкой. От умысла защищает только RLS, см. PROJECT_STATE §42.
  const solutionLock: SolutionLock = (() => {
    if (hwLoading) return { reason: 'Проверяем статус вашего ДЗ…' }
    if (!homework) return null
    if (acceptedAttempt(attempts)) return null

    const active = activeAttempt(attempts)
    if (active?.status === 'submitted') {
      return { reason: 'Работа на проверке. Разбор откроется, когда преподаватель её примет.' }
    }
    if (attempts.some(a => a.status === 'returned_for_revision')) {
      return { reason: 'Работа вернулась на доработку. Разбор откроется после того, как её примут.' }
    }
    return { reason: 'Сначала сдайте ДЗ. Разбор откроется после проверки преподавателем.' }
  })()

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

      {/* ── VIDEO ── */}
      <div className="rounded-2xl overflow-hidden bg-black shadow-md">
        {videoUrl && embedUrl ? (
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

      {/* ── МАТЕРИАЛЫ ТЕМЫ ──
          Скрытые материалы и закрытые темы сюда не доезжают: отсекает RLS
          вместе с topics.available_from. */}
      <TopicMaterialItems topicId={topic.id} canManage={false} solutionLock={solutionLock} />

      {/* ── PDF-ДЗ ТЕМЫ ──
          Неопубликованное ДЗ сюда не доезжает: отсекает RLS.
          Единственная система ДЗ в продукте — topic_homework (решение владельца,
          PROJECT_STATE §9.3). Легаси-блок Homework V1 (homeworks/
          homework_submissions) отсюда удалён 2026-07-27: он дублировал ДЗ
          и путал учеников («Срок не указан» рядом с настоящим дедлайном). */}
      <TopicHomeworkStudent topicId={topic.id} />

      {/* ── ТЕСТИРОВАНИЕ ТЕМЫ ──
          Неопубликованный тест сюда не доезжает: отсекает RLS. */}
      <TopicTestStudent topicId={topic.id} />
    </div>
  )
}
