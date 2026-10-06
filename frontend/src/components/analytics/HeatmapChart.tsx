import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

import { chartColors } from '../../lib/design';

interface HeatmapData {
    userId: string;
    username: string;
    channelId: string;
    channel: string;
    count: number;
}

interface HeatmapChartProps {
    data: HeatmapData[];
    onChannelClick?: (channelId: string, channelName: string) => void;
}

function HeatmapChart({ data, onChannelClick }: HeatmapChartProps) {
    // Aggregate data by channel with channelId
    const channelActivity = data.reduce(
        (acc, item) => {
            if (!acc[item.channel]) {
                acc[item.channel] = {
                    count: 0,
                    channelId: item.channelId,
                    fullName: item.channel,
                };
            }
            acc[item.channel].count += item.count;
            return acc;
        },
        {} as Record<
            string,
            { count: number; channelId: string; fullName: string }
        >
    );

    const chartData = Object.entries(channelActivity)
        .map(([channel, info]) => ({
            channel:
                channel.length > 20
                    ? channel.substring(0, 20) + '...'
                    : channel,
            fullName: info.fullName,
            channelId: info.channelId,
            activity: info.count,
        }))
        .sort((a, b) => b.activity - a.activity)
        .slice(0, 10); // Top 10 channels

    const handleBarClick = (data: unknown) => {
        if (!onChannelClick || !data || typeof data !== 'object') {
            return;
        }

        // Type guard for chart data
        if (
            'channelId' in data &&
            'fullName' in data &&
            typeof data.channelId === 'string' &&
            typeof data.fullName === 'string'
        ) {
            onChannelClick(data.channelId, data.fullName);
        }
    };

    if (chartData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-bl-muted">
                No data available
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartColors.border}
                />
                <XAxis
                    dataKey="channel"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    stroke={chartColors.muted}
                    style={{ fontSize: '12px', fill: chartColors.muted }}
                />
                <YAxis
                    stroke={chartColors.muted}
                    style={{ fontSize: '12px', fill: chartColors.muted }}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: chartColors.canvas,
                        border: `1px solid ${chartColors.border}`,
                        borderRadius: '8px',
                        color: chartColors.ink,
                    }}
                />
                <Legend wrapperStyle={{ color: chartColors.ink }} />
                <Bar
                    dataKey="activity"
                    fill={chartColors.accent}
                    name="Activity Count"
                    onClick={handleBarClick}
                    cursor={onChannelClick ? 'pointer' : 'default'}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

export default HeatmapChart;
