import type { ReactNode } from 'react';

type StatProps = {
    label: ReactNode;
    value: ReactNode;
    note?: ReactNode;
};

/** Key figure with a label and an optional note. Render a group of these inside a <dl>. */
export function Stat({ label, value, note }: StatProps) {
    return (
        <div className="bl-stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
            {note && <span className="bl-stat-note">{note}</span>}
        </div>
    );
}
