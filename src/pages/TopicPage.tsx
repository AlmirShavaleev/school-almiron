import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, BookMarked, BookOpen, Check, CheckCircle,
  Clock, ClipboardList, ExternalLink, FileText, GraduationCap,
  Lightbulb, Loader2, Lock, Paperclip, Play, RotateCcw, Send,
  Video, AlertCircle, ChevronRight, XCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useTopicMaterials } from '@/hooks/useTopicMaterials'
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

interface HwInfo {
  id:        string | null   // null = no formal HW assigned
  max_score: number
  due_date:  string | null
  file_url:  string | null
  status:    string          // 'not_submitted' | 'submitted' | 'checked' | 'revision'
  score:     number | null
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

function niceName(url: string) {
  try {
    return decodeURIComponent(url.split('/').pop() || 'Файл').split('?')[0].replace(/^\d{10,}\./, '')
  } catch { return 'Файл' }
}

// ─── Material section config ──────────────────────────────────────────────────

const SECTIONS = [
  { type: 'notes'    as const, label: 'Конспект',     icon: <BookMarked size={18} />,    color: 'bg-blue-500'   },
  { type: 'theory'   as const, label: 'Теория',       icon: <BookOpen size={18} />,      color: 'bg-purple-500' },
  { type: 'tasks'    as const, label: 'Список задач', icon: <ClipboardList size={18} />, color: 'bg-orange-500' },
  { type: 'homework' as const, label: 'ДЗ',           icon: <Lightbulb size={18} />,     color: 'bg-yellow-500' },
  { type: 'solution' as const, label: 'Решение',      icon: <Check size={18} />,         color: 'bg-green-500'  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TopicPage() {
  const { groupId, topicId } = useParams<{ groupId: string; topicId: string }>()
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  const [topic,      setTopic]      = useState<TopicInfo | null>(null)
  const [hw,           setHw]           = useState<HwInfo>({ id: null, max_score: 100, due_date: null, file_url: null, status: 'not_submitted', score: null })
  const [subExists,    setSubExists]    = useState(false)   // true if a submission row already exists in DB
  const [studentId,    setStudentId]    = useState<string | null>(null)
  const [loading,      setLoading]      = useState(true)

  // Submit form state
  const [hwText,      setHwText]      = useState('')
  const [hwFile,      setHwFile]      = useState<File | null>(null)
  const [hwUploading, setHwUploading] = useState(false)
  const [hwError,     setHwError]     = useState('')
  const hwFileRef = useRef<HTMLInputElement>(null)

  const { materials, loading: matsLoading } = useTopicMaterials(topicId ?? null)

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!topicId || !groupId || !profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // 1. Student record
        const { data: student } = await supabase
          .from('students').select('id').eq('profile_id', profile!.id).single()
        if (!student || cancelled) return
        setStudentId(student.id)

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

        // 3. HW for this topic (курс-уровень, общее для всех групп; может не быть)
        const { data: hwData } = await supabase
          .from('homeworks')
          .select('id, max_score, due_date, file_url')
          .eq('topic_id', topicId!)
          .maybeSingle()

        if (cancelled) return

        if (hwData) {
          const { data: sub } = await supabase
            .from('homework_submissions')
            .select('status, score')
            .eq('homework_id', hwData.id).eq('student_id', student.id)
            .maybeSingle()

          if (!cancelled) {
            setSubExists(!!sub)
            setHw({
              id:        hwData.id,
              max_score: hwData.max_score,
              due_date:  hwData.due_date,
              file_url:  hwData.file_url,
              status:    sub?.status || 'not_submitted',
              score:     sub?.score ?? null,
            })
          }
        }
        // Если ДЗ не назначено — форма сдачи скрыта (hw.id остаётся null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [topicId, groupId, profile])

  // ── Submit homework ──────────────────────────────────────────────────────────

  async function handleHwSubmit() {
    if (!studentId || !topicId) return
    if (!hwText.trim() && !hwFile) { setHwError('Введите ответ или прикрепите файл'); return }
    setHwError(''); setHwUploading(true)

    try {
      // Upload file if attached
      let fileUrl: string | null = null
      if (hwFile) {
        const hwId   = hw.id || topicId
        const ext    = hwFile.name.split('.').pop()
        const path   = `submissions/${hwId}/${studentId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('homeworks')
          .upload(path, hwFile, { contentType: hwFile.type, upsert: true })
        if (upErr) throw new Error('Ошибка загрузки: ' + upErr.message)
        const { data } = supabase.storage.from('homeworks').getPublicUrl(path)
        fileUrl = data.publicUrl
      }

      const payload = {
        answer_text:  hwText.trim() || null,
        file_url:     fileUrl,
        status:       'submitted',
        submitted_at: new Date().toISOString(),
      }

      if (!hw.id) { setHwError('ДЗ не назначено для этой темы'); return }

      if (subExists) {
        const { error } = await supabase.from('homework_submissions')
          .update(payload as any)
          .eq('homework_id', hw.id).eq('student_id', studentId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('homework_submissions')
          .insert({ ...payload, homework_id: hw.id, student_id: studentId } as any)
        if (error) throw error
      }

      setHwText(''); setHwFile(null)
      setSubExists(true)
      setHw(prev => ({ ...prev, status: 'submitted' }))
    } catch (e: any) {
      setHwError(e.message || 'Ошибка при отправке')
    } finally {
      setHwUploading(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const videoUrl   = materials['video']?.link_url || ''
  const ytEmbed    = getYouTubeEmbed(videoUrl)
  const vimeoEmbed = isVimeo(videoUrl) ? getVimeoEmbed(videoUrl) : null
  const embedUrl   = ytEmbed || vimeoEmbed
  // Сравниваем по локальной дате (YYYY-MM-DD), без сдвига в UTC
  const isLocked   = topic?.available_from
    ? topic.available_from.slice(0, 10) > new Date().toLocaleDateString('en-CA')
    : false
  const solutionLocked = hw.status !== 'checked'
  const canSubmit  = hw.status === 'not_submitted' || hw.status === 'revision'

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
          {hw.due_date && (
            <><span className="text-gray-200">·</span><Clock size={11} />
              до {new Date(hw.due_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</>
          )}
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

      {/* ── MATERIALS ── */}
      {!matsLoading && (
        <div className="space-y-3">
          {SECTIONS.map(s => {
            const mat      = materials[s.type]
            const hasFile  = !!mat?.file_url
            const hasText  = !!mat?.content
            const hasLink  = !!mat?.link_url
            const locked   = s.type === 'solution' && solutionLocked
            if (!hasFile && !hasText && !hasLink && !locked) return null

            if (locked) return (
              <div key={s.type} className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-gray-100 bg-gray-50 opacity-60">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0', s.color)}>
                  <Lock size={16} />
                </div>
                <div>
                  <div className="font-semibold text-gray-400 text-sm">{s.label}</div>
                  <div className="text-xs text-gray-400">Откроется после проверки ДЗ преподавателем</div>
                </div>
              </div>
            )

            if (hasFile) return (
              <a key={s.type} href={mat!.file_url!} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-gray-200 bg-white hover:border-primary-300 hover:shadow-sm transition-all group">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0', s.color)}>{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-sm group-hover:text-primary-700">{s.label}</div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">{niceName(mat!.file_url!)}</div>
                </div>
                <FileText size={18} className="text-gray-300 group-hover:text-primary-400 shrink-0" />
              </a>
            )

            if (hasText) return <TextSection key={s.type} section={s} content={mat!.content!} />

            if (hasLink) return (
              <a key={s.type} href={mat!.link_url!} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-gray-200 bg-white hover:border-primary-300 hover:shadow-sm transition-all group">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0', s.color)}>{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-sm group-hover:text-primary-700">{s.label}</div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">{mat!.link_url}</div>
                </div>
                <ExternalLink size={16} className="text-gray-300 group-hover:text-primary-400 shrink-0" />
              </a>
            )
            return null
          })}
        </div>
      )}

      {/* ══ ДОМАШНЕЕ ЗАДАНИЕ — всегда видна ══ */}
      <div className="rounded-2xl border border-gray-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-gray-100">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
            <Lightbulb size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-800">Домашнее задание</div>
            {hw.due_date ? (
              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <Clock size={10} />
                Сдать до {new Date(hw.due_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            ) : (
              <div className="text-xs text-gray-400 mt-0.5">Срок не указан</div>
            )}
          </div>
          {/* Status badge */}
          <span className={cn('text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1 shrink-0', {
            'not_submitted': 'bg-gray-100 text-gray-500',
            'submitted':     'bg-blue-100 text-blue-600',
            'checked':       'bg-green-100 text-green-700',
            'revision':      'bg-orange-100 text-orange-600',
          }[hw.status] || 'bg-gray-100 text-gray-500')}>
            {{
              'not_submitted': <><AlertCircle size={11} />Не сдано</>,
              'submitted':     <><Clock size={11} />На проверке</>,
              'checked':       <><CheckCircle size={11} />{hw.score != null ? `${hw.score}/${hw.max_score} балл.` : 'Принято'}</>,
              'revision':      <><RotateCcw size={11} />Доработать</>,
            }[hw.status] || hw.status}
          </span>
        </div>

        <div className="px-5 py-5 space-y-4 bg-white">

          {/* Teacher's task file */}
          {hw.file_url && (
            <a href={hw.file_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors group">
              <FileText size={18} className="text-amber-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-amber-800">Файл задания от преподавателя</div>
                <div className="text-xs text-amber-500 truncate">{niceName(hw.file_url)}</div>
              </div>
              <ExternalLink size={14} className="text-amber-400 shrink-0" />
            </a>
          )}

          {/* ── ФОРМА СДАЧИ ── */}
          {canSubmit && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-gray-700">
                {hw.status === 'revision' ? '✏️ Исправленная работа' : '📤 Ваш ответ'}
              </div>

              {/* Text answer */}
              <textarea
                rows={4}
                value={hwText}
                onChange={e => { setHwText(e.target.value); setHwError('') }}
                placeholder="Введите решение, ответ или ссылку на Google Docs / Яндекс Диск…"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none placeholder:text-gray-300"
              />

              {/* File attach */}
              {hwFile ? (
                <div className="flex items-center gap-3 p-3.5 bg-green-50 border border-green-200 rounded-xl">
                  <FileText size={20} className="text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-green-800 truncate">{hwFile.name}</div>
                    <div className="text-xs text-green-500">{(hwFile.size / 1024).toFixed(0)} КБ</div>
                  </div>
                  <button
                    onClick={() => { setHwFile(null); if (hwFileRef.current) hwFileRef.current.value = '' }}
                    className="text-green-400 hover:text-red-500 transition-colors p-1"
                  >
                    <XCircle size={20} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => hwFileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors"
                >
                  <Paperclip size={16} />
                  Прикрепить файл (PDF, DOCX, PNG, JPG — до 10 МБ)
                </button>
              )}
              <input
                ref={hwFileRef} type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  if (f.size > 10 * 1024 * 1024) { setHwError('Файл слишком большой (макс. 10 МБ)'); return }
                  setHwFile(f); setHwError('')
                }}
              />

              {hwError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                  {hwError}
                </div>
              )}

              <button
                onClick={handleHwSubmit}
                disabled={hwUploading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 active:scale-[.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {hwUploading
                  ? <><Loader2 size={16} className="animate-spin" />Отправляем…</>
                  : <><Send size={15} />Отправить работу</>
                }
              </button>
            </div>
          )}

          {/* Submitted */}
          {hw.status === 'submitted' && (
            <div className="flex items-start gap-3 py-4 px-4 bg-blue-50 border border-blue-100 rounded-xl">
              <Clock size={18} className="text-blue-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-blue-700 text-sm">Работа отправлена — ожидайте проверки</div>
                <div className="text-xs text-blue-400 mt-1">Преподаватель проверит и выставит оценку</div>
              </div>
            </div>
          )}

          {/* Checked */}
          {hw.status === 'checked' && (
            <div className="flex items-start gap-3 py-4 px-4 bg-green-50 border border-green-100 rounded-xl">
              <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-green-700 text-sm">
                  Работа проверена
                  {hw.score != null && (
                    <span className="ml-2 text-base font-bold">{hw.score} / {hw.max_score} баллов</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Expandable text section ──────────────────────────────────────────────────

function TextSection({ section, content }: { section: typeof SECTIONS[0]; content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0', section.color)}>
          {section.icon}
        </div>
        <span className="flex-1 font-semibold text-gray-800 text-sm">{section.label}</span>
        <ChevronRight size={16} className={cn('text-gray-300 transition-transform shrink-0', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
      )}
    </div>
  )
}
