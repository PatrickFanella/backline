import { forwardRef, useId } from 'react';
import type {
    InputHTMLAttributes,
    ReactNode,
    SelectHTMLAttributes,
    TextareaHTMLAttributes,
} from 'react';

type FieldText = {
    /** Visible label. Keep it the exact text a test or screen reader will use. */
    label: ReactNode;
    /** Supporting text rendered under the control. */
    hint?: ReactNode;
    /** Validation message; marks the control invalid when present. */
    error?: ReactNode;
    /** Lets short controls (numbers, codes) shrink to their content. */
    compact?: boolean;
    className?: string;
};

function describedBy(
    hintId: string,
    errorId: string,
    hint?: ReactNode,
    error?: ReactNode
) {
    const ids = [hint ? hintId : null, error ? errorId : null].filter(Boolean);
    return ids.length ? ids.join(' ') : undefined;
}

function FieldText({
    hintId,
    errorId,
    hint,
    error,
}: {
    hintId: string;
    errorId: string;
    hint?: ReactNode;
    error?: ReactNode;
}) {
    return (
        <>
            {hint && (
                <span id={hintId} className="bl-hint block mt-1">
                    {hint}
                </span>
            )}
            {error && (
                <span id={errorId} className="bl-error-text block mt-1">
                    {error}
                </span>
            )}
        </>
    );
}

type InputProps = FieldText &
    Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, hint, error, compact, className = '', id, ...rest }, ref) => {
        const generated = useId();
        const inputId = id ?? generated;
        const hintId = `${inputId}-hint`;
        const errorId = `${inputId}-error`;
        return (
            <div className={className}>
                <label htmlFor={inputId} className="bl-label">
                    {label}
                </label>
                <input
                    ref={ref}
                    id={inputId}
                    className={`${compact ? 'bl-input-compact' : 'bl-input'} mt-1`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy(hintId, errorId, hint, error)}
                    {...rest}
                />
                <FieldText
                    hintId={hintId}
                    errorId={errorId}
                    hint={hint}
                    error={error}
                />
            </div>
        );
    }
);
Input.displayName = 'Input';

type SelectProps = FieldText &
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
        children: ReactNode;
    };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
    (
        { label, hint, error, compact, className = '', id, children, ...rest },
        ref
    ) => {
        const generated = useId();
        const selectId = id ?? generated;
        const hintId = `${selectId}-hint`;
        const errorId = `${selectId}-error`;
        return (
            <div className={className}>
                <label htmlFor={selectId} className="bl-label">
                    {label}
                </label>
                <select
                    ref={ref}
                    id={selectId}
                    className={`${compact ? 'bl-input-compact' : 'bl-input'} mt-1`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy(hintId, errorId, hint, error)}
                    {...rest}
                >
                    {children}
                </select>
                <FieldText
                    hintId={hintId}
                    errorId={errorId}
                    hint={hint}
                    error={error}
                />
            </div>
        );
    }
);
Select.displayName = 'Select';

type TextareaProps = FieldText &
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, hint, error, className = '', id, ...rest }, ref) => {
        const generated = useId();
        const areaId = id ?? generated;
        const hintId = `${areaId}-hint`;
        const errorId = `${areaId}-error`;
        return (
            <div className={className}>
                <label htmlFor={areaId} className="bl-label">
                    {label}
                </label>
                <textarea
                    ref={ref}
                    id={areaId}
                    className="bl-input mt-1"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy(hintId, errorId, hint, error)}
                    {...rest}
                />
                <FieldText
                    hintId={hintId}
                    errorId={errorId}
                    hint={hint}
                    error={error}
                />
            </div>
        );
    }
);
Textarea.displayName = 'Textarea';

type CheckboxProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'className' | 'type'
> & {
    label: ReactNode;
    hint?: ReactNode;
    className?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
    ({ label, hint, className = '', id, ...rest }, ref) => {
        const generated = useId();
        const boxId = id ?? generated;
        const hintId = `${boxId}-hint`;
        return (
            <div className={className}>
                <label htmlFor={boxId} className="bl-check">
                    <input
                        ref={ref}
                        id={boxId}
                        type="checkbox"
                        aria-describedby={hint ? hintId : undefined}
                        {...rest}
                    />
                    <span>{label}</span>
                </label>
                {hint && (
                    <span id={hintId} className="bl-hint block ml-6">
                        {hint}
                    </span>
                )}
            </div>
        );
    }
);
Checkbox.displayName = 'Checkbox';
