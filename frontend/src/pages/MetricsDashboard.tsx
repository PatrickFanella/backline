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

import { Alert } from '../components/ui/Alert';
import { Page, PageHeader, Section } from '../components/ui/Page';
import { Stat } from '../components/ui/Stat';
import { Table } from '../components/ui/Table';
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

    const header = (
        <PageHeader
            eyebrow="Backline · Metrics"
            title="Metrics & Analytics Dashboard"
            description="Usage insights and performance metrics for the last 7 days"
        />
    );

    if (loading) {
        return (
            <Page>
                {header}
                <p role="status" className="text-bl-muted">
                    Loading analytics…
                </p>
            </Page>
        );
    }

    if (error || !data) {
        return (
            <Page>
                {header}
                <Alert
                    tone="danger"
                    role="alert"
                    title={error || 'No data available'}
                    actions={
                        <button
                            type="button"
                            onClick={fetchDashboardData}
                            className="bl-button bl-button-secondary bl-button-sm"
                        >
                            Retry
                        </button>
                    }
                >
                    <AlertCircle className="sr-only" aria-hidden="true" />
                    The metrics service did not return a dashboard. Retry, or
                    check the service status.
                </Alert>
            </Page>
        );
    }

    const consentRate =
        data.activity.uniqueUsers > 0
            ? `${((data.activity.consentedUsers / data.activity.uniqueUsers) * 100).toFixed(1)}% consent rate`
            : 'No users yet';

    return (
        <Page>
            {header}
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat
                    label={
                        <span className="inline-flex items-center gap-2">
                            <Activity
                                className="w-4 h-4 text-bl-accent"
                                aria-hidden="true"
                            />
                            Total Events
                        </span>
                    }
                    value={data.activity.totalEvents.toLocaleString()}
                />
                <Stat
                    label={
                        <span className="inline-flex items-center gap-2">
                            <Users
                                className="w-4 h-4 text-bl-success"
                                aria-hidden="true"
                            />
                            Unique Users
                        </span>
                    }
                    value={data.activity.uniqueUsers.toLocaleString()}
                />
                <Stat
                    label={
                        <span className="inline-flex items-center gap-2">
                            <TrendingUp
                                className="w-4 h-4 text-bl-accent"
                                aria-hidden="true"
                            />
                            Consented Users
                        </span>
                    }
                    value={data.activity.consentedUsers.toLocaleString()}
                    note={consentRate}
                />
                <Stat
                    label={
                        <span className="inline-flex items-center gap-2">
                            <Clock
                                className="w-4 h-4 text-bl-warning"
                                aria-hidden="true"
                            />
                            Avg Response Time
                        </span>
                    }
                    value={`${data.performance.average.toFixed(0)}ms`}
                    note={`Min: ${data.performance.min.toFixed(0)}ms · Max: ${data.performance.max.toFixed(0)}ms`}
                />
            </dl>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Section id="top-events" title="Top Events">
                    <div className="bl-card p-4">
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
                </Section>

                <Section id="feature-usage" title="Feature Usage">
                    <div className="bl-card p-4">
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
                </Section>
            </div>

            <Section id="feature-details" title="Feature Details">
                <Table caption="Feature usage details">
                    <thead>
                        <tr>
                            <th scope="col">Feature</th>
                            <th scope="col" className="bl-cell-numeric">
                                Total Usage
                            </th>
                            <th scope="col" className="bl-cell-numeric">
                                Unique Users
                            </th>
                            <th scope="col" className="bl-cell-numeric">
                                Avg per User
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.features.map((feature, index) => (
                            <tr key={index}>
                                <td>{feature.featureName}</td>
                                <td className="bl-cell-numeric">
                                    {feature.totalUsage.toLocaleString()}
                                </td>
                                <td className="bl-cell-numeric">
                                    {feature.uniqueUsers.toLocaleString()}
                                </td>
                                <td className="bl-cell-numeric text-bl-muted">
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
                </Table>
            </Section>
        </Page>
    );
}
