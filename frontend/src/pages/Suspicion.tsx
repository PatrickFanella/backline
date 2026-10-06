import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../lib/api';

type UserEntry = {
    userId: string;
    username: string;
    suspicionScore: number;
    ghostScore: number;
    multiClientCount: number;
    channelCount: number;
    accountAgeDays: number;
    avgReactionTime?: number;
    fastReactionCount?: number;
};

function Suspicion() {
    const [data, setData] = useState<UserEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/suspicion')
            .then((res) => {
                setData(res.data);
                setLoading(false);
            })
            .catch((err) => {
                console.error('Error fetching suspicion data:', err);
                setLoading(false);
            });
    }, []);

    const getScoreColor = (score: number) => {
        if (score > 75) return 'text-bl-danger font-bold';
        if (score > 50) return 'text-bl-warning font-semibold';
        return 'text-bl-success';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bl-accent mx-auto mb-4"></div>
                    <p className="text-bl-muted">Loading suspicion data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-6">Suspicion Analysis</h1>

            <div className="mb-4 flex items-center justify-end">
                <p className="text-bl-muted">{data.length} users monitored</p>
            </div>

            <div className="bg-bl-panel rounded-lg shadow-md overflow-hidden">
                <table className="min-w-full divide-y divide-bl-border">
                    <thead className="bg-bl-surface">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Username
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Suspicion Score
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Ghost Score
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Multi-Client
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Channels
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Account Age
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-bl-ink uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-bl-panel divide-y divide-bl-border">
                        {data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="px-6 py-8 text-center text-bl-muted"
                                >
                                    No suspicious users detected
                                </td>
                            </tr>
                        ) : (
                            data.map((user) => (
                                <tr
                                    key={user.userId}
                                    className="hover:bg-bl-panel transition-colors"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-medium text-bl-ink">
                                            {user.username}
                                        </div>
                                        <div className="text-xs text-bl-muted">
                                            {user.userId.substring(0, 8)}...
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <span
                                            className={`text-lg ${getScoreColor(user.suspicionScore)}`}
                                        >
                                            {Math.round(user.suspicionScore)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-bl-ink">
                                        {Math.round(user.ghostScore)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-bl-ink">
                                        {user.multiClientCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-bl-ink">
                                        {user.channelCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-bl-ink">
                                        {user.accountAgeDays} days
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <Link
                                                to={`/suspicion/${user.userId}`}
                                                className="text-bl-accent hover:text-bl-accent text-sm font-medium"
                                            >
                                                Details
                                            </Link>
                                            <span className="text-bl-muted">
                                                |
                                            </span>
                                            <Link
                                                to={`/timeline/${user.userId}`}
                                                className="text-bl-accent hover:text-bl-accent text-sm font-medium"
                                            >
                                                Timeline
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default Suspicion;
