import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
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
import { type HomeCourseProgress } from '@/lib/studentHomeCourses'
import { loadCourseExtras as loadExtras, loadOpenByModule, type CourseExtras as Extras } from '@/lib/courseMeta'
import { accessLine, courseLadder, publicTitle, visibleSteps, type AccessLine, type LadderStep } from '@/lib/myCourses'
import type { PathSubscription } from '@/lib/studentPath'
import { Sticker } from '@/components/student/skin/Sticker'
import { DualRing } from '@/components/student/course/DualRing'
import type { StickerName } from '@/components/student/skin/skin'

/**
 * «Мои курсы» в стиле лендинга (письмо ЛК_стиль_мои_курсы.md, 15.10):
 * белые карточки, синий + оранжевый, 3D-стикер на карточку.
 *
 * Карточка курса: предмет и экзамен пилюлями, публичное название (с витрины,
 * без «(тест)»), режим курса серым, кольцо «пройдено N из M» и полоска
 * разделов — `student_home_courses()` (как на главной), «Продолжить: <тема>»,
 * строка доступа по типу (подписка / пробный / истекла / школьная группа).
 * Клик — программа курса. Прогресс — вариант «Б» (письмо 15.10): кольцо в два
 * слоя (открыто / пройдено), «пройдено N из M · K можно делать сейчас» и
 * лестница разделов. Курс один — карточка шире. Нет курсов — «Пройти диагностику» и «Выбрать курс».
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

function courseSticker(subject: string): StickerName {
  const s = subject.toLowerCase()
  if (s.includes('phys') || s.includes('физ')) return 'rocket'
  if (s.includes('math') || s.includes('мат')) return 'calendar'
  return 'book'
}

function isMockOpen(exams: MockLessonListRow[] | undefined): boolean {
  return !!exams?.length && mockAlert(exams, Date.now())?.kind === 'open'
}

/** Лестница разделов: полоска в три цвета, «15/24» или «✓»; больше 6 — текущий и соседние. */
function Ladder({ steps }: { steps: LadderStep[] }) {
  const [all, setAll] = useState(false)
  const { shown, hidden } = all ? { shown: steps, hidden: 0 } : visibleSteps(steps)
  if (steps.length === 0) return null
  return (
    <div className="stu-steps" data-testid="course-ladder">
      {shown.map(m => (
        <div key={m.moduleId} className={m.current ? 'stu-step-row is-cur' : m.future ? 'stu-step-row is-future' : 'stu-step-row'} data-testid="ladder-step">
          <span className="stu-step-n" title={m.title}>{m.title}</span>
          <span className="stu-step-t" aria-label={`${m.title}: пройдено ${m.done} из ${m.total}, открыто ${m.open}`}>
            <i className="d" style={{ width: `${(m.done / m.total) * 100}%` }} />
            <i className="o" style={{ width: `${((m.open - m.done) / m.total) * 100}%` }} />
          </span>
          <span className="stu-step-v">{m.complete ? '✓' : `${m.done}/${m.total}`}</span>
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className="stu-link self-start" onClick={() => setAll(true)} data-testid="ladder-more">
          ещё {hidden} {plural(hidden, 'раздел', 'раздела', 'разделов')}
        </button>
      )}
    </div>
  )
}

function CourseItem({ card, title, mode, progress, progressNote, openByModule, access, mockExams, wide }: {
  card: CourseCard
  title: string
  mode: 'progress' | 'schedule'
  /** Открытые темы с ДЗ по разделам; null — не узнали. */
  openByModule: Map<string, number> | null
  progress: HomeCourseProgress | null
  /** Прогресса нет: «загружается…» или почему его нет (предпросмотр, сбой). */
  progressNote: string
  access: AccessLine
  mockExams: MockLessonListRow[]
  wide: boolean
}) {
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const ladder = progress ? courseLadder(progress.modules, openByModule, done, total) : null
  const finished = total > 0 && done >= total
  // Владелец 15.10: в карточке ничего не нажимается, кроме одной кнопки
  // «Войти в курс» (и оплаты: «Оформить» / «Продлить») — название и разделы не ссылки.

  return (
    <article className={wide ? 'stu-card stu-mc is-wide' : 'stu-card stu-mc'} data-testid="course-card">
      <div className="stu-mc-head">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="stu-tag t-blue">{SUBJECT_LABELS[card.subject] || card.subject}</span>
            <span className="stu-tag t-or">{EXAM_LABELS[card.examType] || card.examType}</span>
            <span className="stu-muted text-[12.5px]" data-testid="course-mode">{mode === 'progress' ? 'по прохождению' : 'по расписанию'}</span>
          </div>
          <h2 className="stu-h3 mt-2 break-words" data-testid="course-title">{title}</h2>
        </div>
        <Sticker name={courseSticker(card.subject)} size={56} />
      </div>

      <div className="stu-mc-prog">
        {ladder ? <DualRing ladder={ladder} /> : <span className="stu-ring stu-ring-lg" style={{ ['--p' as string]: 0 }}><span>0%</span></span>}
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold" data-testid="course-card-topics">
            {progress ? `пройдено ${done} из ${total}` : progressNote}
            {ladder?.available != null && <span className="stu-muted font-semibold" data-testid="course-available"> · {ladder.available} можно делать сейчас</span>}
          </p>
          {ladder && <Ladder steps={ladder.steps} />}
        </div>
      </div>

      {progress && !progress.next && (
        <p className="stu-muted text-[13.5px]" data-testid="course-continue-none">
          {finished ? 'Курс пройден' : 'Ждём открытия следующей темы'}
        </p>
      )}
      <Link to={`/my-course/${card.groupId}`} className="stu-btn stu-btn-p stu-mc-cta" data-testid="course-continue">
        Войти в курс
      </Link>

      <div className="stu-mc-access" data-testid="course-access" data-kind={access.kind}>
        <span className="min-w-0">{access.text}</span>
        {/* «Моя подписка» не выводим — ссылка; оплата (оформить / продлить) остаётся. */}
        {access.action && access.kind !== 'subscription' && (
          <Link to={access.action.to} className={access.action.primary ? 'stu-btn stu-btn-o stu-btn-sm' : 'stu-link'}>
            {access.action.label}
          </Link>
        )}
      </div>
      <MockExamAlert exams={mockExams} groupId={card.groupId} variant="strip" className="rounded-xl" />
    </article>
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
  const [openByModule, setOpenByModule] = useState<Map<string, number> | null>(null)
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
          const ids = list.map(c => c.courseId)
          const [ex, open] = await Promise.all([loadExtras(ids), preview ? Promise.resolve(null) : loadOpenByModule()])
          if (!cancelled) { setExtras(ex); setOpenByModule(open) }
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

      <div className={cards.length === 1 ? 'stu-mc-single' : 'stu-mc-grid'}>
        {sorted.map(card => (
          <CourseItem
            key={card.groupId}
            card={card}
            title={publicTitle(card.courseTitle, extras.showcase.get(card.courseId))}
            mode={extras.progressMode.has(card.courseId) ? 'progress' : 'schedule'}
            progress={progressByCourse.get(card.courseId) ?? null}
            openByModule={openByModule}
            progressNote={preview ? 'прогресс видит сам ученик' : home.courses === null ? 'прогресс загружается…' : 'пройдено 0 тем'}
            access={accessLine(subByCourse.get(card.courseId), { teacher: card.teacher, group: card.groupName })}
            mockExams={mocksByGroup[card.groupId] ?? []}
            wide={cards.length === 1}
          />
        ))}
      </div>
    </div>
  )
}
