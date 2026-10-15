import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { todayLocal } from '@/lib/topicAvailability'
import { useAuthStore } from '@/store/authStore'
import { usePreviewMode } from '@/store/staffModeStore'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { plural } from '@/lib/plural'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { mockAlert, type MockLessonListRow } from '@/lib/mockExamLesson'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { continueHref, type HomeCourseProgress } from '@/lib/studentHomeCourses'
import { fetchCourseTopicLocks } from '@/lib/progressUnlock'
import { accessLine, nextLessons, publicTitle, type AccessLine, type NextLesson } from '@/lib/myCourses'
import type { PathSubscription } from '@/lib/studentPath'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'

/**
 * «Мои курсы» в стиле лендинга (письмо ЛК_стиль_мои_курсы.md, 15.10):
 * белые карточки, синий + оранжевый, 3D-стикер на карточку.
 *
 * Карточка курса: предмет и экзамен пилюлями, публичное название (с витрины,
 * без «(тест)»), режим курса серым, кольцо «пройдено N из M» и полоска
 * разделов — `student_home_courses()` (как на главной), «Продолжить: <тема>»,
 * строка доступа по типу (подписка / пробный / истекла / школьная группа).
 * Клик — программа курса. Курс один — справа «Что дальше» (2 следующих урока
 * с условием открытия). Нет курсов — «Пройти диагностику» и «Выбрать курс».
 *
 * Только чтение, база не менялась. Прежняя карточка считала «открыто» по всем
 * темам курса — у курса по прохождению выходило 100% и «108/108».
 */

interface CourseCard {
  groupId:     string
  groupName:   string
  courseId:    string
  courseTitle: string
  subject:     string
  examType:    string
  teacher:     string | null
}

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
  teachers?: { profiles: { full_name: string | null } | null } | null
  courses: { id: string; title: string; subject: string; exam_type: string; is_template?: boolean } | null
}

const GROUP_SELECT = 'id, name, course_id, teachers(profiles(full_name)), courses(id, title, subject, exam_type, is_template)'

async function loadPreviewGroups(): Promise<GroupWithCourse[]> {
  const { data } = await supabase.from('groups').select(GROUP_SELECT).order('name')
  return ((data || []) as unknown as GroupWithCourse[])
    .filter(g => g.course_id && g.courses && !g.courses.is_template)
}

async function loadStudentGroups(profileId: string): Promise<GroupWithCourse[] | null> {
  const { data: student } = await supabase
    .from('students').select('id').eq('profile_id', profileId).single()
  if (!student) return null
  const { data: gs } = await supabase
    .from('group_students')
    .select(`group_id, groups(${GROUP_SELECT})`)
    .eq('student_id', student.id)
  return ((gs || []) as unknown as Array<{ groups: GroupWithCourse | null }>)
    .filter(g => g.groups?.course_id && g.groups.courses)
    .map(g => g.groups as GroupWithCourse)
}

// Узкий тип: таблиц витрины и режима нет в сгенерированных типах (они отстают
// от базы и руками не дописываются — CLAUDE.md).
type Rows = PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }>
type Q = Rows & { in: (c: string, v: string[]) => Q; eq: (c: string, v: unknown) => Q }
type Db = { from: (t: string) => { select: (c: string) => Q } }

interface Extras {
  showcase: Map<string, string>
  progressMode: Set<string>
}

async function loadExtras(courseIds: string[]): Promise<Extras> {
  const db = supabase as unknown as Db
  const [show, modes] = await Promise.all([
    db.from('course_showcase').select('course_id, title').in('course_id', courseIds).eq('is_active', true),
    db.from('course_unlock_modes').select('course_id, mode').in('course_id', courseIds),
  ])
  return {
    showcase: new Map(((show.error ? [] : show.data) ?? []).map(r => [String(r.course_id), String(r.title)])),
    progressMode: new Set(((modes.error ? [] : modes.data) ?? []).filter(r => r.mode === 'progress').map(r => String(r.course_id))),
  }
}

function courseSticker(subject: string): StickerName {
  const s = subject.toLowerCase()
  if (s.includes('phys') || s.includes('физ')) return 'rocket'
  if (s.includes('math') || s.includes('мат')) return 'calendar'
  return 'book'
}

function isMockOpen(exams: MockLessonListRow[] | undefined): boolean {
  return !!exams?.length && mockAlert(exams, Date.now())?.kind === 'open'
}

/** Полоска разделов: сегмент на раздел, ширина — по числу тем с ДЗ, заливка — %. */
function ModuleSegments({ p }: { p: HomeCourseProgress }) {
  const mods = p.modules.filter(m => m.total > 0)
  if (mods.length === 0) return null
  return (
    <div className="stu-segs" role="list" aria-label="Разделы">
      {mods.map(m => (
        <span
          key={m.moduleId}
          role="listitem"
          className="stu-seg"
          style={{ flexGrow: m.total }}
          title={`${m.title}: ${m.percent}%`}
          aria-label={`${m.title}: пройдено ${m.done} из ${m.total}`}
        >
          <i style={{ width: `${m.percent}%` }} />
        </span>
      ))}
    </div>
  )
}

function CourseItem({ card, title, mode, progress, progressNote, access, mockExams, wide }: {
  card: CourseCard
  title: string
  mode: 'progress' | 'schedule'
  progress: HomeCourseProgress | null
  /** Прогресса нет: «загружается…» или почему его нет (предпросмотр, сбой). */
  progressNote: string
  access: AccessLine
  mockExams: MockLessonListRow[]
  wide: boolean
}) {
  const navigate = useNavigate()
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const pct = progress?.percent ?? 0
  const finished = total > 0 && done >= total
  // Клик по карточке — программа курса; у ссылок и кнопок внутри — свои адреса.
  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    navigate(`/my-course/${card.groupId}`)
  }

  return (
    <article className={wide ? 'stu-card stu-mc is-wide' : 'stu-card stu-mc'} data-testid="course-card" onClick={open}>
      <div className="stu-mc-head">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="stu-tag t-blue">{SUBJECT_LABELS[card.subject] || card.subject}</span>
            <span className="stu-tag t-or">{EXAM_LABELS[card.examType] || card.examType}</span>
            <span className="stu-muted text-[12.5px]" data-testid="course-mode">{mode === 'progress' ? 'по прохождению' : 'по расписанию'}</span>
          </div>
          <Link to={`/my-course/${card.groupId}`} className="stu-h3 stu-focus mt-2 block break-words hover:text-[var(--blueInk)]" data-testid="course-title">
            {title}
          </Link>
        </div>
        <Sticker name={courseSticker(card.subject)} size={56} />
      </div>

      <div className="flex items-center gap-4">
        <span className="stu-ring stu-ring-lg" style={{ ['--p' as string]: pct }}>
          <span>{pct}%</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold" data-testid="course-card-topics">
            {progress ? `пройдено ${done} из ${total}` : progressNote}
          </p>
          {progress && <ModuleSegments p={progress} />}
        </div>
      </div>

      {progress?.next ? (
        <Link to={continueHref(card.groupId, progress.next)} className="stu-btn stu-btn-p stu-mc-cta" data-testid="course-continue">
          <span className="truncate">Продолжить: {progress.next.title}</span>
        </Link>
      ) : (
        <span className="stu-mc-wait" data-testid="course-continue-none">
          {finished ? 'Курс пройден' : 'Ждём открытия следующей темы'}
        </span>
      )}

      <div className="stu-mc-access" data-testid="course-access" data-kind={access.kind}>
        <span className="min-w-0">{access.text}</span>
        {access.action && (
          <Link to={access.action.to} className={access.action.primary ? 'stu-btn stu-btn-o stu-btn-sm' : 'stu-link'}>
            {access.action.label}
          </Link>
        )}
      </div>
      <MockExamAlert exams={mockExams} groupId={card.groupId} variant="strip" className="rounded-xl" />
    </article>
  )
}

function WhatsNext({ items, groupId }: { items: NextLesson[]; groupId: string }) {
  return (
    <aside className="stu-card stu-next" aria-labelledby="mc-next-h" data-testid="course-next">
      <div className="flex items-center gap-3">
        <Sticker name="lock" size={44} />
        <h2 id="mc-next-h" className="stu-h3">Что дальше</h2>
      </div>
      {items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map(t => (
            <li key={t.id} className="stu-rm-locked">
              <Lock size={15} aria-hidden className="mt-[3px] shrink-0" />
              <span className="min-w-0">
                <span className="block break-words font-semibold">{t.title}</span>
                <small className="block">{t.note}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stu-muted text-[14px]">Все уроки уже открыты.</p>
      )}
      <Link to={`/my-course/${groupId}`} className="stu-link">Вся программа →</Link>
    </aside>
  )
}

export function MyCoursesPage() {
  const profile  = useAuthStore(s => s.profile)
  const preview  = usePreviewMode()
  const subscriptionsOn = useSubscriptionsEnabled()
  const path = useStudentPathHome(profile?.id, subscriptionsOn.enabled && !preview)
  const home = useStudentHomeCourses(preview ? null : profile?.id)
  const [cards,   setCards]   = useState<CourseCard[]>([])
  const [extras,  setExtras]  = useState<Extras>({ showcase: new Map(), progressMode: new Set() })
  const [loading, setLoading] = useState(true)
  const [next,    setNext]    = useState<NextLesson[] | null>(null)
  // §224.2. Идущий пробник — прямо на карточке курса.
  const mocksByGroup = useMyMockExams(cards.map(c => c.groupId))

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const groups = preview ? await loadPreviewGroups() : await loadStudentGroups(profile!.id)
        if (cancelled) return
        const list: CourseCard[] = (groups ?? []).map(g => ({
          groupId:     g.id,
          groupName:   g.name,
          courseId:    g.courses!.id,
          courseTitle: g.courses!.title,
          subject:     g.courses!.subject,
          examType:    g.courses!.exam_type,
          teacher:     g.teachers?.profiles?.full_name ?? null,
        }))
        setCards(list)
        if (list.length > 0) {
          const ex = await loadExtras(list.map(c => c.courseId))
          if (!cancelled) setExtras(ex)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile, preview])

  const subByCourse = useMemo(
    () => new Map((path.data?.subscriptions ?? []).map(s => [s.course_id, s] as [string, PathSubscription])),
    [path.data],
  )
  const progressByCourse = useMemo(() => new Map((home.courses ?? []).map(p => [p.courseId, p])), [home.courses])

  // Курс один — «Что дальше»: замки курса по прохождению или темы с датой.
  const single = cards.length === 1 ? cards[0] : null
  const singleId = single?.courseId ?? null
  const singleMode: 'progress' | 'schedule' = singleId && extras.progressMode.has(singleId) ? 'progress' : 'schedule'
  const singleDemo = !!(singleId && subByCourse.get(singleId)?.demo)
  useEffect(() => {
    if (!singleId) return
    let alive = true
    const today = todayLocal()
    async function load() {
      const locks = singleMode === 'progress' ? await fetchCourseTopicLocks(singleId!) : null
      const dated = singleMode === 'progress'
        ? []
        : ((await supabase.from('topics').select('id, title, is_open, available_from, module:modules!inner(course_id)').eq('module.course_id', singleId!)).data ?? [])
      if (!alive) return
      setNext(nextLessons(locks, dated as unknown as Array<{ id: string; title: string; available_from: string | null; is_open: boolean | null }>, singleDemo, today))
    }
    load().catch(() => { if (alive) setNext([]) })
    return () => { alive = false }
  }, [singleId, singleMode, singleDemo])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 stu-muted">
        <Loader2 size={22} className="animate-spin" />Загрузка курсов…
      </div>
    )
  }

  if (!cards.length) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 py-16 text-center" data-testid="my-courses-empty">
        <Sticker name="book" size={112} />
        <h1 className="stu-h2">Курсов пока нет</h1>
        <p className="stu-muted text-[15px]">
          {preview
            ? 'Нет курсов для предпросмотра: вы не персонал ни одного курса, кроме каркасов'
            : 'Начни с диагностики — она покажет твой уровень и с чего начать. Или сразу выбери курс.'}
        </p>
        {!preview && (
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/diagnostic" className="stu-btn stu-btn-g">Пройти диагностику</Link>
            <Link to="/courses" className="stu-btn stu-btn-p">Выбрать курс →</Link>
          </div>
        )}
      </div>
    )
  }

  // §224.2. Курс, где пробник идёт прямо сейчас, — первым.
  const sorted = [...cards].sort((a, b) => Number(isMockOpen(mocksByGroup[b.groupId])) - Number(isMockOpen(mocksByGroup[a.groupId])))

  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-6 pb-10 pt-2" data-testid="my-courses">
      <div>
        <span className="stu-kicker">Учёба</span>
        <h1 className="stu-h2">Мои курсы</h1>
        <p className="stu-muted mt-1 text-[14px]">
          {cards.length} {plural(cards.length, 'курс', 'курса', 'курсов')}
          {preview && <span data-testid="my-courses-preview-hint"> · курсы, где вы персонал, — как их видит ученик</span>}
        </p>
      </div>

      <div className={single ? 'stu-mc-single' : 'stu-mc-grid'}>
        {sorted.map(card => (
          <CourseItem
            key={card.groupId}
            card={card}
            title={publicTitle(card.courseTitle, extras.showcase.get(card.courseId))}
            mode={extras.progressMode.has(card.courseId) ? 'progress' : 'schedule'}
            progress={progressByCourse.get(card.courseId) ?? null}
            progressNote={preview ? 'прогресс видит сам ученик' : home.courses === null ? 'прогресс загружается…' : 'пройдено 0 тем'}
            access={accessLine(subByCourse.get(card.courseId), { teacher: card.teacher, group: card.groupName })}
            mockExams={mocksByGroup[card.groupId] ?? []}
            wide={!!single}
          />
        ))}
        {single && next && <WhatsNext items={next} groupId={single.groupId} />}
      </div>
    </div>
  )
}
