import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/utils/cn'

type Props = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'aria-current'> & { active: boolean }

export function TopicTaskNumberButton({ active, className, ...props }: Props) {
  return (
    <button
      {...props}
      type="button"
      aria-current={active ? 'step' : undefined}
      className={cn(
        'grid h-9 min-w-9 place-items-center rounded-lg border-[1.5px] px-1.5 text-[13px] font-extrabold tabular-nums transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
        className,
        active && 'ring-2 ring-primary-600 ring-offset-2',
      )}
    />
  )
}
