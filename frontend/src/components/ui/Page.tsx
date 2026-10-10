import type { ReactNode } from 'react';

type PageProps = {
    children: ReactNode;
    /** Narrow pages (forms, single columns) use the 64rem container. */
    narrow?: boolean;
    className?: string;
};

/** Main landmark for app routes: canvas background, gutters and section spacing. */
export function Page({ children, narrow, className = '' }: PageProps) {
    return (
        <main
            id="main-content"
            className={`bl-page ${narrow ? 'bl-page-narrow' : ''} ${className}`}
        >
            <div className="bl-page-inner">{children}</div>
        </main>
    );
}

type PageHeaderProps = {
    eyebrow?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
};

export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
}: PageHeaderProps) {
    return (
        <header className="bl-page-header">
            <div>
                {eyebrow && <p className="bl-eyebrow-app">{eyebrow}</p>}
                <h1>{title}</h1>
                {description && (
                    <p className="bl-page-description">{description}</p>
                )}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
    );
}

type SectionProps = {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    id?: string;
};

export function Section({
    title,
    description,
    actions,
    children,
    id,
}: SectionProps) {
    const headingId = id ? `${id}-heading` : undefined;
    return (
        <section aria-labelledby={headingId} id={id} className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 id={headingId} className="bl-section-title">
                        {title}
                    </h2>
                    {description && (
                        <p className="text-bl-muted mt-1">{description}</p>
                    )}
                </div>
                {actions && (
                    <div className="flex flex-wrap gap-2">{actions}</div>
                )}
            </div>
            {children}
        </section>
    );
}
