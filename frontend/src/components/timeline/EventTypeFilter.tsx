interface EventTypeOption {
    value: string;
    label: string;
    color: string;
}

interface EventTypeFilterProps {
    options: EventTypeOption[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

function EventTypeFilter({
    options,
    selected,
    onChange,
}: EventTypeFilterProps) {
    const handleToggle = (value: string) => {
        if (selected.includes(value)) {
            // Don't allow deselecting all
            if (selected.length > 1) {
                onChange(selected.filter((v) => v !== value));
            }
        } else {
            onChange([...selected, value]);
        }
    };

    const handleSelectAll = () => {
        onChange(options.map((opt) => opt.value));
    };

    const handleDeselectAll = () => {
        // Keep at least one selected
        onChange([options[0].value]);
    };

    return (
        <div className="bg-bl-panel rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-bl-ink">
                    Filter by Event Type
                </h3>
                <div className="flex gap-2">
                    <button
                        onClick={handleSelectAll}
                        className="text-xs text-bl-accent hover:text-bl-accent font-medium"
                    >
                        All
                    </button>
                    <span className="text-bl-muted">|</span>
                    <button
                        onClick={handleDeselectAll}
                        className="text-xs text-bl-accent hover:text-bl-accent font-medium"
                    >
                        None
                    </button>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => {
                    const isSelected = selected.includes(option.value);
                    return (
                        <button
                            key={option.value}
                            onClick={() => handleToggle(option.value)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                                isSelected
                                    ? `${option.color} text-white shadow-sm`
                                    : 'bg-bl-surface text-bl-muted hover:bg-bl-surface'
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default EventTypeFilter;
