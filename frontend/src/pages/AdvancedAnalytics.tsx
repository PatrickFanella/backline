import { Network, GitBranch, Share2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

import ChartExport from '../components/analytics/ChartExport';
import ChordDiagram from '../components/analytics/ChordDiagram';
import DateRangeSelector from '../components/analytics/DateRangeSelector';
import InteractiveFilter from '../components/analytics/InteractiveFilter';
import type { FilterConfig } from '../components/analytics/InteractiveFilter';
import NetworkGraph from '../components/analytics/NetworkGraph';
import SankeyDiagram from '../components/analytics/SankeyDiagram';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
} from '../components/ui/Card';
import { Page, PageHeader } from '../components/ui/Page';
import { Stat } from '../components/ui/Stat';
import { useAnalytics } from '../hooks/useAnalytics';
import api from '../lib/api';

interface AnalyticsData {
    userId: string;
    username: string;
    channelId?: string;
    channel?: string;
    count?: number;
    suspicionScore?: number;
    ghostScore?: number;
    interactions?: number;
}

function AdvancedAnalytics() {
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState<{
        start: Date;
        end: Date;
    } | null>(null);
    const [data, setData] = useState<AnalyticsData[]>([]);
    const [filteredData, setFilteredData] = useState<AnalyticsData[]>([]);
    const [filters, setFilters] = useState<FilterConfig>({
        suspicionMin: 0,
        suspicionMax: 100,
        ghostMin: 0,
        ghostMax: 100,
        channelSearch: '',
        userSearch: '',
        minInteractions: 0,
    });
    const [activeView, setActiveView] = useState<
        'network' | 'sankey' | 'chord'
    >('network');
    const { trackFeatureUsage } = useAnalytics();

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const sinceParam = dateRange?.start.toISOString();

            const [heatmapRes, suspicionRes] = await Promise.all([
                api.get('/heatmap', { params: { since: sinceParam } }),
                api.get('/suspicion', { params: { since: sinceParam } }),
            ]);

            // Combine data
            const combinedData: AnalyticsData[] = [];
            const dataMap = new Map<string, AnalyticsData>();

            // Process heatmap data
            heatmapRes.data.forEach((item: unknown) => {
                const heatmapItem = item as {
                    userId: string;
                    username: string;
                    channelId: string;
                    channel: string;
                    count: number;
                };
                const key = `${heatmapItem.userId}-${heatmapItem.channelId}`;
                dataMap.set(key, {
                    userId: heatmapItem.userId,
                    username: heatmapItem.username,
                    channelId: heatmapItem.channelId,
                    channel: heatmapItem.channel,
                    count: heatmapItem.count,
                    interactions: heatmapItem.count,
                });
            });

            // Merge suspicion data efficiently using a Map indexed by userId
            const suspicionMap = new Map<
                string,
                { suspicionScore: number; ghostScore: number }
            >();
            suspicionRes.data.forEach((item: unknown) => {
                const suspicionItem = item as {
                    userId: string;
                    suspicionScore: number;
                    ghostScore: number;
                };
                suspicionMap.set(suspicionItem.userId, {
                    suspicionScore: suspicionItem.suspicionScore,
                    ghostScore: suspicionItem.ghostScore,
                });
            });

            dataMap.forEach((existing, key) => {
                const suspicion = suspicionMap.get(existing.userId);
                if (suspicion) {
                    dataMap.set(key, {
                        ...existing,
                        suspicionScore: suspicion.suspicionScore,
                        ghostScore: suspicion.ghostScore,
                    });
                }
            });

            dataMap.forEach((value) => combinedData.push(value));
            setData(combinedData);
            setFilteredData(combinedData);

            trackFeatureUsage('advanced_analytics_view');
        } catch (error) {
            console.error('Failed to fetch data:', error);
            toast.error('Failed to fetch analytics data');
        } finally {
            setLoading(false);
        }
    }, [dateRange, trackFeatureUsage]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Apply filters
    useEffect(() => {
        let filtered = [...data];

        // Suspicion score filter
        filtered = filtered.filter(
            (item) =>
                (item.suspicionScore || 0) >= filters.suspicionMin &&
                (item.suspicionScore || 0) <= filters.suspicionMax
        );

        // Ghost score filter
        filtered = filtered.filter(
            (item) =>
                (item.ghostScore || 0) >= filters.ghostMin &&
                (item.ghostScore || 0) <= filters.ghostMax
        );

        // Minimum interactions filter
        filtered = filtered.filter(
            (item) => (item.interactions || 0) >= filters.minInteractions
        );

        // User search filter
        if (filters.userSearch) {
            filtered = filtered.filter((item) =>
                item.username
                    .toLowerCase()
                    .includes(filters.userSearch.toLowerCase())
            );
        }

        // Channel search filter
        if (filters.channelSearch) {
            filtered = filtered.filter(
                (item) =>
                    item.channel &&
                    item.channel
                        .toLowerCase()
                        .includes(filters.channelSearch.toLowerCase())
            );
        }

        setFilteredData(filtered);
    }, [data, filters]);

    return (
        <Page>
            <PageHeader
                eyebrow="Backline · Analytics"
                title="Advanced Analytics"
                description="Interactive visualizations and deep insights"
                actions={
                    <>
                        <Button
                            onClick={fetchData}
                            disabled={loading}
                            isLoading={loading}
                            variant="primary"
                            size="sm"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </Button>
                        <InteractiveFilter onFilterChange={setFilters} />
                    </>
                }
            />
            <div className="space-y-6">
                <DateRangeSelector onRangeChange={setDateRange} />

                {/* View Toggle */}
                <div
                    role="group"
                    aria-label="Visualization"
                    className="flex flex-wrap gap-2"
                >
                    {(
                        [
                            {
                                id: 'network',
                                label: 'Network Graph',
                                Icon: Network,
                            },
                            {
                                id: 'sankey',
                                label: 'Sankey Flow',
                                Icon: GitBranch,
                            },
                            {
                                id: 'chord',
                                label: 'Chord Diagram',
                                Icon: Share2,
                            },
                        ] as const
                    ).map((view) => (
                        <button
                            key={view.id}
                            type="button"
                            className="bl-chip inline-flex items-center gap-2"
                            aria-pressed={activeView === view.id}
                            onClick={() => setActiveView(view.id)}
                        >
                            <view.Icon className="w-4 h-4" aria-hidden="true" />
                            {view.label}
                        </button>
                    ))}
                </div>

                {/* Stats */}
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat
                        label="Total Users"
                        value={new Set(filteredData.map((d) => d.userId)).size}
                    />
                    <Stat
                        label="Total Channels"
                        value={
                            new Set(
                                filteredData
                                    .map((d) => d.channelId)
                                    .filter(Boolean)
                            ).size
                        }
                    />
                    <Stat
                        label="Interactions"
                        value={filteredData.reduce(
                            (sum, item) => sum + (item.interactions || 0),
                            0
                        )}
                    />
                    <Stat
                        label="Filters Active"
                        value={
                            Object.values(filters).filter(
                                (v) => v !== 0 && v !== 100 && v !== ''
                            ).length
                        }
                    />
                </dl>

                {/* Visualization */}
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle>
                                {activeView === 'network' &&
                                    'Network Relationship Graph'}
                                {activeView === 'sankey' &&
                                    'Sankey Flow Diagram'}
                                {activeView === 'chord' &&
                                    'Chord Interaction Diagram'}
                            </CardTitle>
                            <ChartExport
                                elementId="visualization-container"
                                filename={`${activeView}-diagram`}
                            />
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <p
                                role="status"
                                className="bl-empty h-96 flex items-center justify-center"
                            >
                                Loading visualization...
                            </p>
                        ) : (
                            <div id="visualization-container">
                                {activeView === 'network' && (
                                    <NetworkGraph
                                        data={filteredData}
                                        height={500}
                                    />
                                )}
                                {activeView === 'sankey' && (
                                    <SankeyDiagram
                                        data={filteredData}
                                        width={800}
                                        height={500}
                                    />
                                )}
                                {activeView === 'chord' && (
                                    <ChordDiagram
                                        data={filteredData}
                                        width={600}
                                        height={600}
                                    />
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Help Text */}
                <Alert tone="info" role="none" title="Reading the views">
                    <p>
                        <strong>Network graph</strong> shows relationships
                        between users and channels. Node size represents
                        activity level.
                    </p>
                    <p>
                        <strong>Sankey flow</strong> visualizes the flow of
                        interactions from users to channels.
                    </p>
                    <p>
                        <strong>Chord diagram</strong> displays interaction
                        patterns between all entities in a circular layout.
                    </p>
                </Alert>
            </div>
        </Page>
    );
}

export default AdvancedAnalytics;
