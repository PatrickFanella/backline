/**
 * Metrics & Analytics Dashboard Page
 * Displays comprehensive usage metrics and insights
 */

import { Activity, Users, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

import { getDashboardData } from '../lib/analytics';
import { chartColors, chartPalette } from '../lib/design';

interface DashboardData {
    activity: {
        totalEvents: number;
        uniqueUsers: number;
        consentedUsers: number;
        topEvents: Array<{ eventName: string; count: number }>;
    };
    features: Array<{
        featureName: string;
        totalUsage: number;
        uniqueUsers: number;
    }>;
    performance: {
        average: number;
        min: number;
        max: number;
        count: number;
    };
    summary: Array<{
        summaryDate: Date;
        metric: string;
        value: number;
    }>;
}

const COLORS = chartPalette;

export default function MetricsDashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await getDashboardData();
            setData(response.data);
        } catch (err) {
            console.error('Error fetching dashboard data:', err);
            setError('Failed to load analytics data');
            toast.error('Failed to load analytics data');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bl-accent mx-auto mb-4"></div>
                    <p className="text-bl-muted">Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-bl-danger mx-auto mb-4" />
                    <p className="text-bl-muted">
                        {error || 'No data available'}
                    </p>
                    <button
                        onClick={fetchDashboardData}
                        className="mt-4 px-4 py-2 bg-bl-action hover:bg-bl-action rounded-lg transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-bl-recessed p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">
                        Metrics & Analytics Dashboard
                    </h1>
                    <p className="text-bl-muted">
                        Usage insights and performance metrics for the last 7
                        days
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-bl-muted text-sm font-medium">
                                Total Events
                            </h3>
                            <Activity className="w-5 h-5 text-bl-accent" />
                        </div>
                        <p className="text-3xl font-bold text-white">
                            {data.activity.totalEvents.toLocaleString()}
                        </p>
                    </div>

                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-bl-muted text-sm font-medium">
                                Unique Users
                            </h3>
                            <Users className="w-5 h-5 text-bl-success" />
                        </div>
                        <p className="text-3xl font-bold text-white">
                            {data.activity.uniqueUsers.toLocaleString()}
                        </p>
                    </div>

                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-bl-muted text-sm font-medium">
                                Consented Users
                            </h3>
                            <TrendingUp className="w-5 h-5 text-bl-accent" />
                        </div>
                        <p className="text-3xl font-bold text-white">
                            {data.activity.consentedUsers.toLocaleString()}
                        </p>
                        <p className="text-sm text-bl-muted mt-1">
                            {data.activity.uniqueUsers > 0
                                ? `${((data.activity.consentedUsers / data.activity.uniqueUsers) * 100).toFixed(1)}% consent rate`
                                : 'No users yet'}
                        </p>
                    </div>

                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-bl-muted text-sm font-medium">
                                Avg Response Time
                            </h3>
                            <Clock className="w-5 h-5 text-bl-warning" />
                        </div>
                        <p className="text-3xl font-bold text-white">
                            {data.performance.average.toFixed(0)}ms
                        </p>
                        <p className="text-sm text-bl-muted mt-1">
                            Min: {data.performance.min.toFixed(0)}ms | Max:{' '}
                            {data.performance.max.toFixed(0)}ms
                        </p>
                    </div>
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Top Events Bar Chart */}
                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <h3 className="text-lg font-semibold text-white mb-4">
                            Top Events
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart
                                data={data.activity.topEvents.slice(0, 8)}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke={chartColors.border}
                                />
                                <XAxis
                                    dataKey="eventName"
                                    stroke={chartColors.muted}
                                    angle={-45}
                                    textAnchor="end"
                                    height={100}
                                />
                                <YAxis stroke={chartColors.muted} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: chartColors.panel,
                                        border: `1px solid ${chartColors.border}`,
                                    }}
                                    labelStyle={{ color: chartColors.ink }}
                                />
                                <Bar
                                    dataKey="count"
                                    fill={chartColors.accent}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Feature Usage Pie Chart */}
                    <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                        <h3 className="text-lg font-semibold text-white mb-4">
                            Feature Usage
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={data.features.slice(0, 6)}
                                    dataKey="totalUsage"
                                    nameKey="featureName"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    label
                                >
                                    {data.features
                                        .slice(0, 6)
                                        .map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={
                                                    COLORS[
                                                        index % COLORS.length
                                                    ]
                                                }
                                            />
                                        ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: chartColors.panel,
                                        border: `1px solid ${chartColors.border}`,
                                    }}
                                    labelStyle={{ color: chartColors.ink }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Feature Usage Table */}
                <div className="bg-bl-recessed rounded-lg p-6 border border-bl-border">
                    <h3 className="text-lg font-semibold text-white mb-4">
                        Feature Details
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-bl-border">
                                    <th className="text-left py-3 px-4 text-bl-muted font-medium">
                                        Feature
                                    </th>
                                    <th className="text-right py-3 px-4 text-bl-muted font-medium">
                                        Total Usage
                                    </th>
                                    <th className="text-right py-3 px-4 text-bl-muted font-medium">
                                        Unique Users
                                    </th>
                                    <th className="text-right py-3 px-4 text-bl-muted font-medium">
                                        Avg per User
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.features.map((feature, index) => (
                                    <tr
                                        key={index}
                                        className="border-b border-bl-border hover:bg-bl-recessed transition-colors"
                                    >
                                        <td className="py-3 px-4 text-white">
                                            {feature.featureName}
                                        </td>
                                        <td className="py-3 px-4 text-right text-white">
                                            {feature.totalUsage.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right text-white">
                                            {feature.uniqueUsers.toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right text-bl-muted">
                                            {feature.uniqueUsers > 0
                                                ? (
                                                      feature.totalUsage /
                                                      feature.uniqueUsers
                                                  ).toFixed(1)
                                                : '0.0'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
