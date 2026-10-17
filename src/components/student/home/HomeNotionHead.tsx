import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ImageIcon } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import { HOME_COVERS, coverById, readCover, saveCover, type HomeCover } from '@/lib/homeNotion'

/** Фон обложки: сцена лендинга или градиент бренда с 3D-стикерами. */
function CoverArt({ cover, thumb = false }: { cover: HomeCover; thumb?: boolean }) {
  if (cover.image) {
    return <img src={cover.image} alt="" className="stu-cover-img" style={{ objectPosition: cover.focus }} loading={thumb ? 'lazy' : 'eager'} decoding="async" draggable={false} />
  }
  return (
    <span className="stu-cover-grad" style={{ background: cover.background }}>
      {!thumb && cover.stickers?.map((s, i) => (
        <span key={i} className="stu-cover-st" style={{ right: s.right, left: s.left, top: s.top }}>
          <Sticker name={s.name} size={s.size} />
        </span>
      ))}
    </span>
  )
}

/**
 * Обложка во всю ширину (письмо ЛК_стиль_главная_как_notion.md, 16.10): набор
 * из пяти, «Сменить обложку» — справа снизу (на компьютере видна при наведении,
 * на телефоне — значок). Выбор — в localStorage, без базы.
 */
export function HomeCoverBlock({ profileId }: { profileId: string | null }) {
  // Выбор привязан к ученику: сменился профиль — читаем его обложку заново.
  const [picked, setPicked] = useState<{ pid: string | null; id: string } | null>(null)
  const id = picked && picked.pid === profileId ? picked.id : readCover(profileId)
  const setId = (next: string) => setPicked({ pid: profileId, id: next })
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const cover = coverById(id)

  return (
    <div className="stu-cover" data-testid="home-cover" data-cover={cover.id}>
      <CoverArt cover={cover} />
      <div className="stu-cover-ctl" ref={box}>
        <button type="button" className="stu-cover-btn stu-focus" onClick={() => setOpen(o => !o)}
          aria-expanded={open} aria-label="Сменить обложку" data-testid="home-cover-change">
          <ImageIcon size={15} aria-hidden /><span className="stu-cover-btn-t">Сменить обложку</span>
        </button>
        {open && (
          <div className="stu-cover-pop" role="group" aria-label="Обложка" data-testid="home-cover-pop">
            {HOME_COVERS.map(c => (
              <button key={c.id} type="button" className="stu-cover-pick stu-focus" aria-pressed={c.id === cover.id}
                data-testid={`home-cover-${c.id}`}
                onClick={() => { setId(c.id); saveCover(profileId, c.id); setOpen(false) }}>
                <span className="stu-cover-thumb"><CoverArt cover={c} thumb /></span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export interface HomeProp {
  key: string
  icon: 'target' | 'book' | 'calendar' | 'rocket'
  label: string
  value: ReactNode
  title?: string
}

/**
 * Аватар поверх нижнего края обложки, заголовок «Имя · подготовка к ЕГЭ» и
 * строка свойств мелким: цель, курс, подписка «до …», серия дней.
 */
export function HomeTitle({ name, initials, avatarUrl, exam, props, action, children }: {
  name: string
  initials: string
  avatarUrl: string | null
  exam: 'ЕГЭ' | 'ОГЭ' | null
  props: HomeProp[]
  /** Главная кнопка справа — «Продолжить урок →». */
  action?: ReactNode
  /** Под строкой свойств — строка Telegram. */
  children?: ReactNode
}) {
  return (
    <div className="stu-nhead" data-testid="home-head">
      <div className="stu-nava" aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
      </div>
      <div className="stu-nhead-row">
        <h1 className="stu-ntitle">
          {name}{exam && <span className="stu-muted"> · подготовка к {exam}</span>}
        </h1>
        {action}
      </div>
      {props.length > 0 && (
        <ul className="stu-nprops" data-testid="home-props">
          {props.map(p => (
            <li key={p.key} data-testid={`home-prop-${p.key}`} title={p.title}>
              <Sticker name={p.icon} size={20} />
              <span className="stu-muted">{p.label}</span>
              <span className="stu-nprop-v">{p.value}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  )
}

/** Чип курса в строке свойств. */
export function CourseChip({ to, title }: { to: string; title: string }) {
  return <Link to={to} className="stu-nchip">{title}</Link>
}
