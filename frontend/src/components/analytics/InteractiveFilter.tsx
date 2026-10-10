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
                <Filter className="w-4 h-4" />
                Filters
                {activeFiltersCount > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-white/20 text-white rounded-full">
                        {activeFiltersCount}
                    </span>
                )}
            </Button>

            {isOpen && (
                <div className="absolute top-full mt-2 right-0 z-50 w-96 max-w-[calc(100vw-2rem)] bl-card p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="bl-section-title">Filter Options</h3>
                        <button
                            type="button"
                            aria-label="Close filters"
                            onClick={() => setIsOpen(false)}
                            className="text-bl-muted hover:text-bl-ink"
                        >
                            <X className="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* Suspicion Score Range */}
                        <fieldset>
                            <legend className="bl-label text-sm mb-1">
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
                                    className="bl-input-compact w-24"
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
                                    className="bl-input-compact w-24"
                                />
                            </div>
                        </fieldset>

                        {/* Ghost Score Range */}
                        <fieldset>
                            <legend className="bl-label text-sm mb-1">
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
                                    className="bl-input-compact w-24"
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
                                    className="bl-input-compact w-24"
                                />
                            </div>
                        </fieldset>

                        {/* Minimum Interactions */}
                        <div>
                            <label
                                htmlFor="minimum-interactions"
                                className="bl-label text-sm mb-1"
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
                                className="bl-input"
                            />
                        </div>

                        {/* User Search */}
                        <div>
                            <label
                                htmlFor="user-search"
                                className="bl-label text-sm mb-1"
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
                                className="bl-input"
                            />
                        </div>

                        {/* Channel Search */}
                        <div>
                            <label
                                htmlFor="channel-search"
                                className="bl-label text-sm mb-1"
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
                                className="bl-input"
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
