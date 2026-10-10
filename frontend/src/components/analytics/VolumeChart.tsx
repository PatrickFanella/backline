import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

import { chartColors } from '../../lib/design';

interface VolumeData {
    userId: string;
    username: string;
    typingCount: number;
    messageCount: number;
}

interface VolumeChartProps {
    data: VolumeData[];
    onUserClick?: (userId: string, username: string) => void;
}

function VolumeChart({ data, onUserClick }: VolumeChartProps) {
    // Aggregate total typing and message counts
    const totalTyping = data.reduce((sum, item) => sum + item.typingCount, 0);
    const totalMessages = data.reduce(
        (sum, item) => sum + item.messageCount,
        0
    );

    // Top users by activity
    const topUsers = [...data]
        .sort(
            (a, b) =>
                b.typingCount +
                b.messageCount -
                (a.typingCount + a.messageCount)
        )
        .slice(0, 10);

    const chartData = topUsers.map((user) => ({
        name:
            user.username.length > 15
                ? user.username.substring(0, 15) + '...'
                : user.username,
        fullName: user.username,
        userId: user.userId,
        typing: user.typingCount,
        messages: user.messageCount,
    }));

    const handleAreaClick = (data: unknown) => {
        if (!onUserClick || !data || typeof data !== 'object') {
            return;
        }

        // Type guard for chart data
        if (
            'userId' in data &&
            'fullName' in data &&
            typeof data.userId === 'string' &&
            typeof data.fullName === 'string'
        ) {
            onUserClick(data.userId, data.fullName);
        }
    };

    if (chartData.length === 0) {
        return (
            <div className="bl-empty flex items-center justify-center h-64">
                No data available
            </div>
        );
    }

    return (
        <div>
            <div
                className="mb-4 flex gap-4 text-sm"
                role="status"
                aria-live="polite"
            >
                <div>
                    <span className="text-bl-muted dark:text-bl-muted">
                        Total Typing Events:{' '}
                    </span>
                    <span className="font-semibold">
                        {totalTyping.toLocaleString()}
                    </span>
                </div>
                <div>
                    <span className="text-bl-muted dark:text-bl-muted">
                        Total Messages:{' '}
                    </span>
                    <span className="font-semibold">
                        {totalMessages.toLocaleString()}
                    </span>
                </div>
            </div>
            <div
                role="region"
                aria-label={`Volume chart showing top ${topUsers.length} users by activity. Total typing events: ${totalTyping}, Total messages: ${totalMessages}`}
            >
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                            dataKey="name"
                            angle={-45}
                            textAnchor="end"
                            height={100}
                        />
                        <YAxis />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: chartColors.panel,
                                border: `1px solid ${chartColors.border}`,
                                borderRadius: '4px',
                                color: chartColors.ink,
                            }}
                            labelStyle={{ color: chartColors.ink }}
                        />
                        <Area
                            type="monotone"
                            dataKey="typing"
                            stackId="1"
                            stroke={chartColors.warning}
                            fill={chartColors.warning}
                            name="Typing Events"
                            onClick={handleAreaClick}
                            cursor={onUserClick ? 'pointer' : 'default'}
                        />
                        <Area
                            type="monotone"
                            dataKey="messages"
                            stackId="1"
                            stroke={chartColors.success}
                            fill={chartColors.success}
                            name="Messages"
                            onClick={handleAreaClick}
                            cursor={onUserClick ? 'pointer' : 'default'}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            {/* Screen reader accessible data table */}
            <details className="bl-details mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-bl-accent">
                    View volume data as table
                </summary>
                <div className="mt-2 bl-table-wrap">
                    <table className="bl-table">
                        <caption className="sr-only">
                            User Activity Volume Data
                        </caption>
                        <thead>
                            <tr>
                                <th scope="col">Username</th>
                                <th scope="col" className="bl-cell-numeric">
                                    Typing Events
                                </th>
                                <th scope="col" className="bl-cell-numeric">
                                    Messages
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {topUsers.map((user) => (
                                <tr key={user.userId}>
                                    <td>{user.username}</td>
                                    <td className="bl-cell-numeric">
                                        {user.typingCount}
                                    </td>
                                    <td className="bl-cell-numeric">
                                        {user.messageCount}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    );
}

export default VolumeChart;
