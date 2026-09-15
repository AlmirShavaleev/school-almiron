import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, GraduationCap, Calendar, CheckCircle,
  Clock, ChevronRight, Loader2, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isTopicOpen, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'
import { useAuthStore } from '@/store/authStore'
import { usePreviewMode } from '@/store/staffModeStore'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { getSubjectColor } from '@/lib/subjectColors'
import { pluralTopics } from '@/lib/plural'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseCard {
  groupId:     string
  groupName:   string
  courseId:    string
  courseTitle: string
  subject:     string
  examType:    string
  startDate:   string | null
  endDate:     string | null
  totalTopics: number
  doneTopics:  number
}

// Цвет предмета переехал в `lib/subjectColors` — той же палитрой красится
// метка курса в списке ДЗ. Значения не менялись.

function formatDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="white" strokeWidth={6}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
        {pct}%
      </div>
    </div>
  )
}

// ─── Course card ──────────────────────────────────────────────────────────────

function CourseItem({ card }: { card: CourseCard }) {
  const { from, to, icon } = getSubjectColor(card.subject)
  const pct = card.totalTopics > 0 ? Math.round(card.doneTopics / card.totalTopics * 100) : 0

  return (
    <Link
      to={`/my-course/${card.groupId}`}
      className="group block rounded-2xl overflow-hidden border border-gray-200 hover:border-primary-300 hover:shadow-lg transition-all duration-200"
    >
      {/* Top gradient band */}
      <div className={cn('bg-gradient-to-br p-5 text-white', from, to)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl leading-none">{icon}</span>
              <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                {SUBJECT_LABELS[card.subject] || card.subject}
              </span>
              <span className="text-xs bg-white/15 px-2 py-0.5 rounded-full">
                {EXAM_LABELS[card.examType] || card.examType}
              </span>
            </div>
            <h3 className="text-lg font-bold leading-tight group-hover:opacity-90 transition-opacity">
              {card.courseTitle}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-white/75 mt-1.5">
              <Users size={11} />
              {card.groupName}
            </div>
          </div>
          <ProgressRing pct={pct} />
        </div>
      </div>

      {/* Bottom info row */}
      <div className="bg-white px-5 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <CheckCircle size={12} className="text-green-500" />
            {/* Слово согласуется со ВТОРЫМ числом — именно оно стоит рядом
                с ним: «2 / 24 темы открыто». */}
            <span data-testid="course-card-topics">
              {card.doneTopics} / {pluralTopics(card.totalTopics)} открыто
            </span>
          </span>
          {card.startDate && (
            <span className="flex items-center gap-1.5">
              <Calendar size={12} />
              {formatDate(card.startDate)}
              {card.endDate && ` — ${formatDate(card.endDate)}`}
            </span>
          )}
          {!card.startDate && (
            <span className="flex items-center gap-1.5">
              <Clock size={12} />Без ограничений
            </span>
          )}
        </div>
        <ChevronRight size={16} className="text-gray-300 group-hover:text-primary-500 transition-colors shrink-0" />
      </div>
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Предпросмотр глазами ученика (§178): вместо зачислений — группы курсов, где
 * владелец персонал. Читаем `groups` с вложенным курсом под той же RLS, что и
 * «Программа курса» (`course_is_staff` для преподавателя, всё — для админа):
 * второго правила «мои ли это курсы» здесь не заводим. Каркасы (`is_template`)
 * выбрасываем — у учеников их нет. Форма строки та же, что у зачислений
 * ученика, поэтому дальше страница не различает, откуда пришёл список.
 */
interface GroupWithCourse {
  id: string
  name: string
  course_id: string | null
  courses: {
    id: string; title: string; subject: string; exam_type: string
    start_date: string | null; end_date: string | null; is_template?: boolean
  } | null
}

async function loadPreviewGroups(): Promise<GroupWithCourse[]> {
  const { data } = await supabase
    .from('groups')
    .select('id, name, course_id, courses(id, title, subject, exam_type, start_date, end_date, is_template)')
    .order('name')
  return ((data || []) as unknown as GroupWithCourse[])
    .filter(g => g.course_id && g.courses && !g.courses.is_template)
}

async function loadStudentGroups(profileId: string): Promise<GroupWithCourse[] | null> {
  // 1. student record
  const { data: student } = await supabase
    .from('students').select('id').eq('profile_id', profileId).single()
  if (!student) return null

  // 2. All groups the student is in (with course info)
  const { data: gs } = await supabase
    .from('group_students')
    .select('group_id, groups(id, name, course_id, courses(id, title, subject, exam_type, start_date, end_date))')
    .eq('student_id', student.id)

  return ((gs || []) as unknown as Array<{ groups: GroupWithCourse | null }>)
    .filter(g => g.groups?.course_id)
    .map(g => g.groups as GroupWithCourse)
}

export function MyCoursesPage() {
  const profile  = useAuthStore(s => s.profile)
  const preview  = usePreviewMode()
  const [cards,   setCards]   = useState<CourseCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const groupsWithCourse = preview
          ? await loadPreviewGroups()
          : await loadStudentGroups(profile!.id)
        if (!groupsWithCourse || cancelled) return

        if (!groupsWithCourse.length || cancelled) {
          setCards([])
          return
        }

        // 3. Load progress for each course (topics count + done count)
        const courseIds = groupsWithCourse.map((g: any) => g.courses.id)
        const groupIds  = groupsWithCourse.map((g: any) => g.id)

        // §141. Вторая цифра карточки считалась по `homework_submissions` +
        // `homeworks` — это ДЗ первой версии, обе таблицы пусты, и «выполнено»
        // всегда было нулём независимо от данных. Теперь карточка считает
        // ОТКРЫТЫЕ ТЕМЫ — тем же правилом, что страница курса.
        const modsRes = await supabase.from('modules')
          .select('course_id, topics(id, is_open, available_from)')
          .in('course_id', courseIds)

        if (cancelled) return

        const today = todayLocal()
        const topicsByCourse: Record<string, number> = {}
        const openByCourse: Record<string, number> = {}
        for (const mod of modsRes.data || []) {
          const cid = (mod as any).course_id
          const tops = ((mod as any).topics || []) as TopicOpenState[]
          topicsByCourse[cid] = (topicsByCourse[cid] || 0) + tops.length
          openByCourse[cid] = (openByCourse[cid] || 0)
            + tops.filter(t => isTopicOpen(t, today)).length
        }

        const result: CourseCard[] = groupsWithCourse.map((g: any) => ({
          groupId:     g.id,
          groupName:   g.name,
          courseId:    g.courses.id,
          courseTitle: g.courses.title,
          subject:     g.courses.subject,
          examType:    g.courses.exam_type,
          startDate:   g.courses.start_date || null,
          endDate:     g.courses.end_date   || null,
          totalTopics: topicsByCourse[g.courses.id] || 0,
          doneTopics:  openByCourse[g.courses.id] || 0,
        }))

        setCards(result)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, preview])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-gray-400">
        <Loader2 size={22} className="animate-spin" />Загрузка курсов…
      </div>
    )
  }

  if (!cards.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
        <BookOpen size={44} className="opacity-25" />
        <p className="text-sm">
          {preview
            ? 'Нет курсов для предпросмотра: вы не персонал ни одного курса, кроме каркасов'
            : 'Вы не записаны ни в один курс'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Мои курсы</h1>
        <p className="text-gray-500 mt-1 text-sm flex items-center gap-1.5">
          <GraduationCap size={14} />
          {cards.length} {cards.length === 1 ? 'курс' : cards.length < 5 ? 'курса' : 'курсов'}
          {preview && <span data-testid="my-courses-preview-hint">· курсы, где вы персонал, — как их видит ученик</span>}
        </p>
      </div>

      <div className="space-y-4">
        {cards.map(card => (
          <CourseItem key={card.groupId} card={card} />
        ))}
      </div>
    </div>
  )
}
