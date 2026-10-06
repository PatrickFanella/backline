import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Hash, Activity, AlertTriangle } from 'lucide-react';

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
                className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-bl-panel rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="sticky top-0 bg-bl-panel border-b border-bl-surface p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-bl-surface rounded-lg">
                                <Icon className="w-6 h-6 text-bl-accent" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-bl-ink">
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
                            onClick={onClose}
                            className="p-2 hover:bg-bl-surface rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-bl-muted" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            {data.details.suspicionScore !== undefined && (
                                <div className="bg-bl-surface rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangle className="w-4 h-4 text-bl-danger" />
                                        <span className="text-sm text-bl-muted">
                                            Suspicion Score
                                        </span>
                                    </div>
                                    <p className="text-2xl font-bold text-bl-ink">
                                        {data.details.suspicionScore}
                                    </p>
                                </div>
                            )}

                            {data.details.ghostScore !== undefined && (
                                <div className="bg-bl-surface rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <User className="w-4 h-4 text-bl-mauve" />
                                        <span className="text-sm text-bl-muted">
                                            Ghost Score
                                        </span>
                                    </div>
                                    <p className="text-2xl font-bold text-bl-ink">
                                        {data.details.ghostScore}
                                    </p>
                                </div>
                            )}

                            {data.details.messageCount !== undefined && (
                                <div className="bg-bl-surface rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Activity className="w-4 h-4 text-bl-success" />
                                        <span className="text-sm text-bl-muted">
                                            Messages
                                        </span>
                                    </div>
                                    <p className="text-2xl font-bold text-bl-ink">
                                        {data.details.messageCount}
                                    </p>
                                </div>
                            )}

                            {data.details.channelCount !== undefined && (
                                <div className="bg-bl-surface rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Hash className="w-4 h-4 text-bl-accent" />
                                        <span className="text-sm text-bl-muted">
                                            Channels
                                        </span>
                                    </div>
                                    <p className="text-2xl font-bold text-bl-ink">
                                        {data.details.channelCount}
                                    </p>
                                </div>
                            )}

                            {data.details.interactions !== undefined && (
                                <div className="bg-bl-surface rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Activity className="w-4 h-4 text-bl-warning" />
                                        <span className="text-sm text-bl-muted">
                                            Interactions
                                        </span>
                                    </div>
                                    <p className="text-2xl font-bold text-bl-ink">
                                        {data.details.interactions}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Recent Activity */}
                        {data.details.recentActivity &&
                            data.details.recentActivity.length > 0 && (
                                <div>
                                    <h3 className="text-lg font-semibold text-bl-ink mb-3">
                                        Recent Activity
                                    </h3>
                                    <div className="space-y-2">
                                        {data.details.recentActivity.map(
                                            (activity, index) => (
                                                <div
                                                    key={index}
                                                    className="bg-bl-surface rounded-lg p-3 flex justify-between items-center"
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
                            <div className="text-center py-8 text-bl-muted">
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
