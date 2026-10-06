import { Filter, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui/Button';

interface FilterConfig {
    suspicionMin: number;
    suspicionMax: number;
    ghostMin: number;
    ghostMax: number;
    channelSearch: string;
    userSearch: string;
    minInteractions: number;
}

interface InteractiveFilterProps {
    onFilterChange: (filters: FilterConfig) => void;
    initialFilters?: Partial<FilterConfig>;
}

const defaultFilters: FilterConfig = {
    suspicionMin: 0,
    suspicionMax: 100,
    ghostMin: 0,
    ghostMax: 100,
    channelSearch: '',
    userSearch: '',
    minInteractions: 0,
};

function InteractiveFilter({
    onFilterChange,
    initialFilters = {},
}: InteractiveFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [filters, setFilters] = useState<FilterConfig>({
        ...defaultFilters,
        ...initialFilters,
    });

    const handleFilterChange = (
        key: keyof FilterConfig,
        value: string | number
    ) => {
        const newFilters = { ...filters, [key]: value };
        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    const resetFilters = () => {
        setFilters(defaultFilters);
        onFilterChange(defaultFilters);
    };

    const activeFiltersCount = Object.entries(filters).filter(
        ([key, value]) => {
            if (
                key === 'suspicionMin' ||
                key === 'ghostMin' ||
                key === 'minInteractions'
            ) {
                return value > 0;
            }
            if (key === 'suspicionMax' || key === 'ghostMax') {
                return value < 100;
            }
            return value !== '';
        }
    ).length;

    return (
        <div className="relative">
            <Button
                onClick={() => setIsOpen(!isOpen)}
                variant={activeFiltersCount > 0 ? 'primary' : 'secondary'}
                size="md"
                className="relative"
            >
                <Filter className="w-4 h-4 mr-2" />
                Filters
                {activeFiltersCount > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-bl-danger-solid text-white rounded-full">
                        {activeFiltersCount}
                    </span>
                )}
            </Button>

            {isOpen && (
                <div className="absolute top-full mt-2 right-0 z-50 w-96 bg-bl-panel border border-bl-surface rounded-lg shadow-lg p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-bl-ink">
                            Filter Options
                        </h3>
                        <button
                            type="button"
                            aria-label="Close filters"
                            onClick={() => setIsOpen(false)}
                            className="text-bl-muted hover:text-bl-ink"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* Suspicion Score Range */}
                        <fieldset>
                            <legend className="block text-sm font-medium text-bl-ink mb-2">
                                Suspicion Score Range
                            </legend>
                            <div className="flex items-center gap-2">
                                <input
                                    aria-label="Minimum suspicion score"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={filters.suspicionMin}
                                    onChange={(e) =>
                                        handleFilterChange(
                                            'suspicionMin',
                                            parseInt(e.target.value) || 0
                                        )
                                    }
                                    className="w-20 px-2 py-1 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                                />
                                <span className="text-bl-muted">to</span>
                                <input
                                    aria-label="Maximum suspicion score"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={filters.suspicionMax}
                                    onChange={(e) =>
                                        handleFilterChange(
                                            'suspicionMax',
                                            parseInt(e.target.value) || 100
                                        )
                                    }
                                    className="w-20 px-2 py-1 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                                />
                            </div>
                        </fieldset>

                        {/* Ghost Score Range */}
                        <fieldset>
                            <legend className="block text-sm font-medium text-bl-ink mb-2">
                                Ghost Score Range
                            </legend>
                            <div className="flex items-center gap-2">
                                <input
                                    aria-label="Minimum ghost score"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={filters.ghostMin}
                                    onChange={(e) =>
                                        handleFilterChange(
                                            'ghostMin',
                                            parseInt(e.target.value) || 0
                                        )
                                    }
                                    className="w-20 px-2 py-1 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                                />
                                <span className="text-bl-muted">to</span>
                                <input
                                    aria-label="Maximum ghost score"
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={filters.ghostMax}
                                    onChange={(e) =>
                                        handleFilterChange(
                                            'ghostMax',
                                            parseInt(e.target.value) || 100
                                        )
                                    }
                                    className="w-20 px-2 py-1 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                                />
                            </div>
                        </fieldset>

                        {/* Minimum Interactions */}
                        <div>
                            <label
                                htmlFor="minimum-interactions"
                                className="block text-sm font-medium text-bl-ink mb-2"
                            >
                                Minimum Interactions
                            </label>
                            <input
                                id="minimum-interactions"
                                type="number"
                                min="0"
                                value={filters.minInteractions}
                                onChange={(e) =>
                                    handleFilterChange(
                                        'minInteractions',
                                        parseInt(e.target.value) || 0
                                    )
                                }
                                className="w-full px-3 py-2 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                            />
                        </div>

                        {/* User Search */}
                        <div>
                            <label
                                htmlFor="user-search"
                                className="block text-sm font-medium text-bl-ink mb-2"
                            >
                                Search Users
                            </label>
                            <input
                                id="user-search"
                                type="text"
                                value={filters.userSearch}
                                onChange={(e) =>
                                    handleFilterChange(
                                        'userSearch',
                                        e.target.value
                                    )
                                }
                                placeholder="Enter username..."
                                className="w-full px-3 py-2 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                            />
                        </div>

                        {/* Channel Search */}
                        <div>
                            <label
                                htmlFor="channel-search"
                                className="block text-sm font-medium text-bl-ink mb-2"
                            >
                                Search Channels
                            </label>
                            <input
                                id="channel-search"
                                type="text"
                                value={filters.channelSearch}
                                onChange={(e) =>
                                    handleFilterChange(
                                        'channelSearch',
                                        e.target.value
                                    )
                                }
                                placeholder="Enter channel name..."
                                className="w-full px-3 py-2 bg-bl-surface text-bl-ink rounded border border-bl-border focus:border-bl-accent focus:outline-none"
                            />
                        </div>

                        {/* Reset Button */}
                        <div className="pt-2">
                            <Button
                                onClick={resetFilters}
                                variant="secondary"
                                size="sm"
                                className="w-full"
                            >
                                Reset All Filters
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default InteractiveFilter;
export type { FilterConfig };
