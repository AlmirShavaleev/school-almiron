import type { ReactNode } from 'react'

/**
 * Знак «Орбита» из `_бренд/` (файлы в `public/brand/` как есть, не
 * перерисованы). Светлая и тёмная версии лежат рядом, видимую выбирает CSS
 * по теме лендинга — без JS и без мигания при загрузке.
 */
export function Mark({ size = 34, white = false, className }: { size?: number; white?: boolean; className?: string }) {
  if (white) {
    return <img className={className} src="/brand/orbita-belyj.svg" alt="" width={size} height={size} aria-hidden="true" />
  }
  return (
    <span className={className ? `mark ${className}` : 'mark'} style={{ width: size, height: size }} aria-hidden="true">
      <img className="mark-l" src="/brand/orbita-svetlyj-fon.svg" alt="" width={size} height={size} />
      <img className="mark-d" src="/brand/orbita-temnyj-fon.svg" alt="" width={size} height={size} />
    </span>
  )
}

/**
 * Плашка как в PDF-листах: заголовок на сплошной заливке, тело — светлая
 * карточка. `navy` — «Из кодификатора ЕГЭ», `trap` (оранжевая) — «Ловушка
 * ЕГЭ», `blue` — карточка задачи из «Решений».
 */
export function Plate({ tone = 'navy', title, note, children, serif = true }: {
  tone?: 'navy' | 'trap' | 'blue'
  title: ReactNode
  note?: ReactNode
  children: ReactNode
  serif?: boolean
}) {
  return (
    <div className={`plate plate-${tone}`}>
      <div className="plate-h"><b>{title}</b>{note && <span>{note}</span>}</div>
      <div className={serif ? 'plate-b serif' : 'plate-b'}>{children}</div>
    </div>
  )
}
