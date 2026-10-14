import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chat, type Msg } from '@/pages/landing/Chat'
import { Sticker } from '@/components/student/skin/Sticker'
import type { ExamCountdown } from '@/lib/examCountdown'
import type { HomeContinue } from '@/lib/studentHomeCourses'

const SEEN_KEY = 'almiron:home-chat-seen'

/** Диалог «печатает…» — один раз за вкладку; дальше пузыри сразу на месте. */
function useChatOnce(): boolean {
  const [instant] = useState(() => {
    try {
      const seen = sessionStorage.getItem(SEEN_KEY) === '1'
      sessionStorage.setItem(SEEN_KEY, '1')
      return seen
    } catch {
      return false
    }
  })
  return instant
}

/**
 * Первый экран главной ученика как hero лендинга (письмо 14.10): дата и дни
 * до экзамена курсивом, приветствие, реплика Альмира пузырём и кнопки; справа
 * — сцена с орбитой и 3D-стикерами, в центре — «N дней до ЕГЭ». Данные — те
 * же, что у прежней шапки: имя, московская дата, `examCountdown` и
 * «Продолжить урок» (`student_home_courses`), новых запросов нет.
 */
export function HomeHero({ name, todayLabel, countdown, next, continueTo, hasCourses, coursesOn }: {
  name: string
  todayLabel: string
  countdown: ExamCountdown | null
  next: { title: string; moduleTitle: string | null; courseTitle: string } | null
  continueTo: string | null
  hasCourses: boolean
  /** Подписка открыта — без курсов зовём на витрину «Курсы». */
  coursesOn: boolean
}) {
  const instant = useChatOnce()
  const exam = countdown ? (countdown.exam === 'ege' ? 'ЕГЭ' : 'ОГЭ') : null

  const msgs = useMemo<Msg[]>(() => {
    if (next) {
      return [
        { text: <>Сегодня у тебя урок <b>«{next.title}»</b>{next.moduleTitle ? <> из раздела «{next.moduleTitle}»</> : null}. Видео, теория, задачи — и сдаём ДЗ. Начнём?</> },
        { me: true, text: 'Погнали' },
      ]
    }
    if (hasCourses) {
      return [{ text: <>Все открытые темы с ДЗ сданы — <b>отличная работа</b>. Загляни в курс: там разборы и задачи, а следующая тема скоро откроется.</> }]
    }
    return [{
      text: coursesOn
        ? <>Курсов пока нет. Загляни в <b>«Курсы»</b> — там можно начать с пробного доступа.</>
        : <>Курсов пока нет. Как только преподаватель добавит тебя в группу, курс появится здесь.</>,
    }]
  }, [next, hasCourses, coursesOn])

  return (
    <section className="stu-hero" data-testid="home-hero">
      <div className="flex min-w-0 flex-col gap-3.5">
        <p className="stu-eb">
          {todayLabel}
          {countdown && <> · {countdown.label} {countdown.days} {countdown.daysWord}</>}
        </p>
        <h1 className="stu-h1 break-words">
          Привет, {name}!
          {next && exam && <> Сегодня — <span className="stu-orange">новый шаг</span> к <span className="stu-blue">{exam}</span></>}
        </h1>
        <Chat msgs={msgs} autoStart instant={instant} className="mt-1" />
        <div className="stu-hero-actions">
          {continueTo && (
            <Link to={continueTo} className="stu-btn stu-btn-p" data-testid="hero-continue">Продолжить урок →</Link>
          )}
          {hasCourses
            ? <Link to="/my-homework" className="stu-btn stu-btn-g">Домашние задания</Link>
            : coursesOn && <Link to="/courses" className="stu-btn stu-btn-p">Выбрать курс →</Link>}
        </div>
      </div>

      <div className="stu-scene" aria-hidden="true">
        <div className="stu-orbit" />
        {countdown && (
          <div className="stu-card stu-count" data-testid="exam-countdown" title={countdown.hint}>
            <span className="stu-kicker">{countdown.label}</span>
            <b>{countdown.days}</b>
            <span className="text-[15px] font-extrabold">{countdown.daysWord}</span>
            <span className="stu-muted text-[13px]">{countdown.note}</span>
          </div>
        )}
        <span className="stu-float s-1" style={{ right: '4%', top: '2%' }}>
          <Sticker name="rocket" size={112} />
        </span>
        <span className="stu-float s-2" style={{ left: '4%', top: '6%', animationDelay: '-1s', animationDuration: '6s' }}>
          <Sticker name="calendar25" size={84} />
        </span>
        <span className="stu-float s-2" style={{ left: '8%', bottom: '4%', animationDelay: '-2.5s', animationDuration: '6.5s' }}>
          <Sticker name="target" size={92} />
        </span>
      </div>
    </section>
  )
}
