import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

import { chartColors } from '../../lib/design';

interface TimelineData {
    userId: string;
    username: string;
    suspicionScore: number;
    ghostScore: number;
}

interface TimelineChartProps {
    data: TimelineData[];
    onUserClick?: (userId: string, username: string) => void;
}

function TimelineChart({ data, onUserClick }: TimelineChartProps) {
    // Sort by suspicion score and take top 10 for clarity
    const topUsers = [...data]
        .sort((a, b) => b.suspicionScore - a.suspicionScore)
        .slice(0, 10);

    const chartData = topUsers.map((user, index) => ({
        name:
            user.username.length > 15
                ? user.username.substring(0, 15) + '...'
                : user.username,
        fullName: user.username,
        userId: user.userId,
        suspicion: user.suspicionScore,
        ghost: user.ghostScore,
        rank: index + 1,
    }));

    const handleLineClick = (data: unknown) => {
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
            <div>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
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
                        <Legend />
                        <Line
                            type="monotone"
                            dataKey="suspicion"
                            stroke={chartColors.danger}
                            name="Suspicion Score"
                            strokeWidth={2}
                            onClick={handleLineClick}
                            cursor={onUserClick ? 'pointer' : 'default'}
                        />
                        <Line
                            type="monotone"
                            dataKey="ghost"
                            stroke={chartColors.accent}
                            name="Ghost Score"
                            strokeWidth={2}
                            onClick={handleLineClick}
                            cursor={onUserClick ? 'pointer' : 'default'}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            {/* Screen reader accessible data table */}
            <details className="bl-details mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-bl-accent">
                    View suspicion data as table
                </summary>
                <div className="mt-2 bl-table-wrap">
                    <table className="bl-table">
                        <caption className="sr-only">
                            User Suspicion and Ghost Score Data
                        </caption>
                        <thead>
                            <tr>
                                <th scope="col">Rank</th>
                                <th scope="col">Username</th>
                                <th scope="col" className="bl-cell-numeric">
                                    Suspicion Score
                                </th>
                                <th scope="col" className="bl-cell-numeric">
                                    Ghost Score
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {topUsers.map((user, index) => (
                                <tr key={user.userId}>
                                    <td>{index + 1}</td>
                                    <td>{user.username}</td>
                                    <td className="bl-cell-numeric">
                                        {user.suspicionScore}
                                    </td>
                                    <td className="bl-cell-numeric">
                                        {user.ghostScore}
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

export default TimelineChart;
