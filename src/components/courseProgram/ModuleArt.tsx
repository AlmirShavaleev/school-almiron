import type { ModuleArtKey } from '@/lib/moduleArt'

/**
 * §281. Рисунок раздела в углу карточки — белые линии, прозрачность задаёт
 * карточка. Чистая графика без текста-смысла (aria-hidden): название раздела
 * написано рядом.
 */
export function ModuleArt({ kind, className }: { kind: ModuleArtKey; className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden data-art={kind}>
      {ART[kind]}
    </svg>
  )
}

const ART: Record<ModuleArtKey, React.ReactNode> = {
  math: (
    <>
      <path d="M20 140 C60 140 80 40 180 24" />
      <path d="M20 20 V140 H190" strokeWidth={4} />
      <path d="M118 112 c0-14 8-20 14-20 M132 92 c0 30 -6 44 -18 44" strokeWidth={5} />
      <path d="M150 78 l16 16 M166 78 l-16 16" strokeWidth={5} />
    </>
  ),
  kinematics: (
    <>
      <path d="M14 150 Q80 -10 186 104" strokeDasharray="14 12" />
      <circle cx="186" cy="104" r="12" fill="currentColor" stroke="none" />
      <path d="M150 64 l30 10 l-10 28" strokeWidth={5} />
    </>
  ),
  dynamics: (
    <>
      <rect x="64" y="56" width="66" height="50" rx="8" />
      <path d="M130 81 H192 M178 68 l14 13 l-14 13" />
      <path d="M64 81 H10 M24 68 l-14 13 l14 13" />
      <path d="M97 106 V152 M84 138 l13 14 l13 -14" />
    </>
  ),
  conservation: (
    <>
      <circle cx="58" cy="90" r="28" />
      <circle cx="146" cy="90" r="28" />
      <path d="M8 90 H28 M176 90 H196 M18 80 l10 10 l-10 10" strokeWidth={5} />
      <path d="M86 40 q16 -18 32 0" strokeWidth={5} />
    </>
  ),
  statics: (
    <>
      <path d="M100 30 V60 M30 60 H170" />
      <path d="M100 60 L84 150 H116 Z" />
      <path d="M30 60 L18 100 H42 Z M170 60 L158 100 H182 Z" strokeWidth={5} />
    </>
  ),
  oscillations: (
    <path d="M6 80 C26 20 46 20 66 80 S106 140 126 80 S166 20 196 80" />
  ),
  molecular: (
    <>
      <circle cx="50" cy="60" r="14" /><circle cx="120" cy="40" r="10" /><circle cx="160" cy="110" r="16" />
      <circle cx="80" cy="128" r="11" /><circle cx="176" cy="44" r="8" />
      <path d="M64 66 l20 8 M130 46 l14 10 M92 120 l20 -6" strokeWidth={4} />
    </>
  ),
  electric: (
    <path d="M118 8 L58 92 H104 L84 154 L150 64 H104 Z" />
  ),
  magnetic: (
    <>
      <path d="M40 20 V90 a60 60 0 0 0 120 0 V20" />
      <path d="M40 20 H76 V90 a24 24 0 0 0 48 0 V20 H160" strokeWidth={4} />
    </>
  ),
  optics: (
    <>
      <path d="M100 14 C126 50 126 110 100 146 C74 110 74 50 100 14 Z" />
      <path d="M8 50 H100 L190 120 M8 110 H100 L190 40" strokeWidth={4} />
    </>
  ),
  quantum: (
    <>
      <circle cx="100" cy="80" r="10" fill="currentColor" stroke="none" />
      <ellipse cx="100" cy="80" rx="86" ry="30" />
      <ellipse cx="100" cy="80" rx="86" ry="30" transform="rotate(60 100 80)" />
      <ellipse cx="100" cy="80" rx="86" ry="30" transform="rotate(-60 100 80)" />
    </>
  ),
  ege: (
    <>
      <rect x="40" y="16" width="120" height="140" rx="10" />
      <path d="M64 50 H136 M64 78 H136 M64 106 H110" strokeWidth={5} />
      <path d="M118 126 l12 12 l26 -30" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="100" cy="80" rx="88" ry="40" />
      <circle cx="100" cy="80" r="18" />
      <circle cx="186" cy="74" r="9" fill="currentColor" stroke="none" />
    </>
  ),
}
