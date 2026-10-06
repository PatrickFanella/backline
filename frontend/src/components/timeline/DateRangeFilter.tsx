import { Calendar, X } from 'lucide-react';

interface DateRangeFilterProps {
    startDate: string;
    endDate: string;
    onStartDateChange: (date: string) => void;
    onEndDateChange: (date: string) => void;
    onClear: () => void;
}

function DateRangeFilter({
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
    onClear,
}: DateRangeFilterProps) {
    const hasDateFilter = startDate || endDate;

    return (
        <div className="bg-bl-panel rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-bl-muted" />
                    <h3 className="text-sm font-semibold text-bl-ink">
                        Date Range
                    </h3>
                </div>
                {hasDateFilter && (
                    <button
                        onClick={onClear}
                        className="text-xs text-bl-accent hover:text-bl-accent font-medium flex items-center gap-1"
                    >
                        <X className="h-3 w-3" />
                        Clear
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label
                        htmlFor="startDate"
                        className="block text-xs text-bl-muted mb-1"
                    >
                        Start Date
                    </label>
                    <input
                        type="date"
                        id="startDate"
                        value={startDate}
                        onChange={(e) => onStartDateChange(e.target.value)}
                        className="block w-full px-3 py-2 border border-bl-border rounded-lg focus:ring-2 focus:ring-bl-accent focus:border-bl-accent text-sm"
                    />
                </div>
                <div>
                    <label
                        htmlFor="endDate"
                        className="block text-xs text-bl-muted mb-1"
                    >
                        End Date
                    </label>
                    <input
                        type="date"
                        id="endDate"
                        value={endDate}
                        onChange={(e) => onEndDateChange(e.target.value)}
                        className="block w-full px-3 py-2 border border-bl-border rounded-lg focus:ring-2 focus:ring-bl-accent focus:border-bl-accent text-sm"
                    />
                </div>
            </div>
        </div>
    );
}

export default DateRangeFilter;
