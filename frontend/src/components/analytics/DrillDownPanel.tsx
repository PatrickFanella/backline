import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Hash, Activity, AlertTriangle } from 'lucide-react';

import { Stat } from '../ui/Stat';

interface DrillDownData {
    type: 'user' | 'channel';
    id: string;
    name: string;
    details: {
        suspicionScore?: number;
        ghostScore?: number;
        messageCount?: number;
        channelCount?: number;
        interactions?: number;
        recentActivity?: Array<{
            timestamp: string;
            action: string;
            channel?: string;
        }>;
    };
}

interface DrillDownPanelProps {
    data: DrillDownData | null;
    onClose: () => void;
}

function DrillDownPanel({ data, onClose }: DrillDownPanelProps) {
    if (!data) return null;

    const isUser = data.type === 'user';
    const Icon = isUser ? User : Hash;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-bl-deep/70 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="drilldown-title"
                    className="bl-card max-w-2xl w-full max-h-[80vh] overflow-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="sticky top-0 bg-bl-panel border-b-2 border-bl-border p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-bl-accent/10 rounded">
                                <Icon className="w-6 h-6 text-bl-accent" />
                            </div>
                            <div>
                                <h2
                                    id="drilldown-title"
                                    className="text-xl uppercase"
                                >
                                    {data.name}
                                </h2>
                                <p className="text-sm text-bl-muted">
                                    {isUser
                                        ? 'User Details'
                                        : 'Channel Details'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close details"
                            className="p-2 hover:bg-bl-surface rounded transition-colors"
                        >
                            <X
                                className="w-5 h-5 text-bl-muted"
                                aria-hidden="true"
                            />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        {/* Metrics Grid */}
                        <dl className="grid grid-cols-2 gap-4">
                            {data.details.suspicionScore !== undefined && (
                                <Stat
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <AlertTriangle
                                                className="w-4 h-4 text-bl-danger"
                                                aria-hidden="true"
                                            />
                                            Suspicion Score
                                        </span>
                                    }
                                    value={data.details.suspicionScore}
                                />
                            )}
                            {data.details.ghostScore !== undefined && (
                                <Stat
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <User
                                                className="w-4 h-4 text-bl-accent"
                                                aria-hidden="true"
                                            />
                                            Ghost Score
                                        </span>
                                    }
                                    value={data.details.ghostScore}
                                />
                            )}
                            {data.details.messageCount !== undefined && (
                                <Stat
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <Activity
                                                className="w-4 h-4 text-bl-success"
                                                aria-hidden="true"
                                            />
                                            Messages
                                        </span>
                                    }
                                    value={data.details.messageCount}
                                />
                            )}
                            {data.details.channelCount !== undefined && (
                                <Stat
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <Hash
                                                className="w-4 h-4 text-bl-accent"
                                                aria-hidden="true"
                                            />
                                            Channels
                                        </span>
                                    }
                                    value={data.details.channelCount}
                                />
                            )}
                            {data.details.interactions !== undefined && (
                                <Stat
                                    label={
                                        <span className="inline-flex items-center gap-2">
                                            <Activity
                                                className="w-4 h-4 text-bl-warning"
                                                aria-hidden="true"
                                            />
                                            Interactions
                                        </span>
                                    }
                                    value={data.details.interactions}
                                />
                            )}
                        </dl>

                        {/* Recent Activity */}
                        {data.details.recentActivity &&
                            data.details.recentActivity.length > 0 && (
                                <div>
                                    <h3 className="bl-section-title mb-3">
                                        Recent Activity
                                    </h3>
                                    <div className="space-y-2">
                                        {data.details.recentActivity.map(
                                            (activity, index) => (
                                                <div
                                                    key={index}
                                                    className="bg-bl-recessed border border-bl-border/40 rounded p-3 flex justify-between items-center"
                                                >
                                                    <div>
                                                        <p className="text-sm text-bl-ink">
                                                            {activity.action}
                                                        </p>
                                                        {activity.channel && (
                                                            <p className="text-xs text-bl-muted mt-1">
                                                                in #
                                                                {
                                                                    activity.channel
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-bl-muted">
                                                        {new Date(
                                                            activity.timestamp
                                                        ).toLocaleString()}
                                                    </p>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}

                        {/* Empty State */}
                        {(!data.details.recentActivity ||
                            data.details.recentActivity.length === 0) && (
                            <div className="bl-empty">
                                <p>No recent activity available</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

export default DrillDownPanel;
export type { DrillDownData };
