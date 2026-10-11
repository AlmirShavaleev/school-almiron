import { Link } from 'react-router-dom'
import { LINKS } from './links'
import { Mark } from './Brand'

const ANCHORS: Array<[string, string]> = [
  ['#a1', '5 аргументов'],
  ['#inside', 'Платформа'],
  ['#price', 'Цена'],
  ['#faq', 'Вопросы'],
]

export function Header({ onToggleTheme }: { onToggleTheme: () => void }) {
  return (
    <header className="nav">
      <div className="wrap">
        <a className="logo" href="#top"><Mark size={34} />Школа Almiron</a>
        <nav className="nav-links" aria-label="Разделы">
          {ANCHORS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className="nav-r">
          <button type="button" className="theme-t" onClick={onToggleTheme} aria-label="Сменить тему">◐</button>
          <Link className="btn btn-g" to={LINKS.login}>Войти</Link>
          <Link className="btn btn-p" to={LINKS.register}>Регистрация</Link>
        </div>
      </div>
    </header>
  )
}
