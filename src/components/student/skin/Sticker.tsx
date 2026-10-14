import { stickerSrc, type StickerName } from './skin'

/**
 * 3D-стикер лендинга. Декор: alt пустой, смысл всегда написан рядом текстом.
 * Явные размеры (без сдвига раскладки), ленивая загрузка.
 */
export function Sticker({ name, size = 64, className }: { name: StickerName; size?: number; className?: string }) {
  return (
    <img
      className={className ? `stu-sticker ${className}` : 'stu-sticker'}
      src={stickerSrc(name)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  )
}
