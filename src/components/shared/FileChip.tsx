import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { middleEllipsis } from '@/lib/fileName'

/**
 * Чип с именем файла — единственное место, где решается, как длинное имя
 * ведёт себя на узком экране (§158, аудит №6 и №21).
 *
 * Два правила:
 *  · чип никогда не шире родителя (`max-w-full min-w-0`), а имя внутри —
 *    `truncate`, поэтому один чип не может раздвинуть страницу;
 *  · середина имени обрезана заранее (`middleEllipsis`), чтобы хвост с
 *    номером страницы и расширением оставался виден, полное имя — в `title`.
 *
 * Ссылку (`SignedFileLink`) и цвета рамки чип не знает — их даёт вызывающий,
 * чип отвечает только за содержимое. Родитель должен быть `flex-wrap`, чтобы
 * чипы переносились строками.
 */
interface FileChipProps {
  name: string
  /** Слот слева от имени — бейдж IMG/PDF или иконка. */
  leading?: ReactNode
  /** Слот справа — пометки вроде «без разметки». */
  trailing?: ReactNode
  className?: string
  /** Предел длины имени до обрезки середины. */
  maxLength?: number
}

export function FileChip({ name, leading, trailing, className, maxLength = 28 }: FileChipProps) {
  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5', className)} data-testid="file-chip">
      {leading}
      <span className="min-w-0 truncate" title={name}>{middleEllipsis(name, maxLength)}</span>
      {trailing}
    </span>
  )
}
