import type { ModuleRecord } from './ModuleSettings';

type Props = {
    module: ModuleRecord;
    busy: string | null;
    onToggle: (module: ModuleRecord) => void;
    /** Visible name for screen readers when several toggles share a page. */
    describedBy?: string;
};

/** Enable/disable control shared by the module catalog and module pages. */
export default function ModuleToggle({
    module,
    busy,
    onToggle,
    describedBy,
}: Props) {
    const enabled = module.settings.enabled;
    return (
        <button
            type="button"
            aria-pressed={enabled}
            aria-describedby={describedBy}
            disabled={busy !== null || (!module.operatorReady && !enabled)}
            onClick={() => onToggle(module)}
            className={
                enabled
                    ? 'bl-button bl-button-secondary bl-button-sm'
                    : 'bl-button bl-button-primary bl-button-sm'
            }
        >
            {busy === module.id ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
        </button>
    );
}
