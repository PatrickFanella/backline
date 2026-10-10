import type { ReactNode, TableHTMLAttributes } from 'react';

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
    caption?: ReactNode;
    children: ReactNode;
};

/** Scrollable data table. Pass a caption for screen readers; it stays visually hidden. */
export function Table({
    caption,
    children,
    className = '',
    ...rest
}: TableProps) {
    return (
        <div className="bl-table-wrap">
            <table className={`bl-table ${className}`} {...rest}>
                {caption && <caption className="sr-only">{caption}</caption>}
                {children}
            </table>
        </div>
    );
}
