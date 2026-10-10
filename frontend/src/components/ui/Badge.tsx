import type { ReactNode } from 'react';

type BadgeProps = {
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
    children: ReactNode;
    className?: string;
};

/** Compact uppercase label for states and categories. Pair it with text that names the state. */
export function Badge({
    tone = 'neutral',
    children,
    className = '',
}: BadgeProps) {
    const toneClass = tone === 'neutral' ? '' : `bl-badge-${tone}`;
    return (
        <span className={`bl-badge ${toneClass} ${className}`}>{children}</span>
    );
}
