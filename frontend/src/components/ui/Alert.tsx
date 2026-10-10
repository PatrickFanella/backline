import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const icons = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: XCircle,
};

type AlertProps = {
    tone?: Tone;
    title?: ReactNode;
    children?: ReactNode;
    /** Danger alerts announce assertively; others politely. Override when needed. */
    role?: 'alert' | 'status' | 'none';
    actions?: ReactNode;
    className?: string;
};

/** Inline message with an icon and a tone. Meaning is carried by icon and text, not color alone. */
export function Alert({
    tone = 'info',
    title,
    children,
    role,
    actions,
    className = '',
}: AlertProps) {
    const Icon = icons[tone];
    const resolvedRole = role ?? (tone === 'danger' ? 'alert' : 'status');
    return (
        <div
            role={resolvedRole === 'none' ? undefined : resolvedRole}
            className={`bl-alert bl-alert-${tone} ${className}`}
        >
            <Icon className="bl-alert-icon w-5 h-5" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-1">
                {title && <p className="font-semibold">{title}</p>}
                {children && <div className="text-sm">{children}</div>}
                {actions && (
                    <div className="pt-2 flex flex-wrap gap-2">{actions}</div>
                )}
            </div>
        </div>
    );
}
