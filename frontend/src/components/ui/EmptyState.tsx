import type { ReactNode } from 'react';

type EmptyStateProps = {
    title: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    as?: 'h2' | 'h3';
};

/** Explains why a list is empty and what the reader can do about it. */
export function EmptyState({
    title,
    children,
    actions,
    as: Heading = 'h2',
}: EmptyStateProps) {
    return (
        <section className="bl-empty space-y-3">
            <Heading>{title}</Heading>
            {children && <div className="max-w-prose mx-auto">{children}</div>}
            {actions && (
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                    {actions}
                </div>
            )}
        </section>
    );
}
