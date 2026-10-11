import { iconSrc, type IconName } from './icons'

/**
 * 3D-иконка как картинка: явные размеры (CLS), ниже первого экрана — lazy.
 * Декоративная: смысл всегда написан рядом текстом.
 */
export function Icon3D({ name, size = 72, className = 'ic3d' }: { name: IconName; size?: number; className?: string }) {
  return (
    <img
      className={className}
      src={iconSrc(name)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  )
}
