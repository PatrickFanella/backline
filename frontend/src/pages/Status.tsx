import { useEffect, useState } from 'react';

interface ServiceStatus {
    status: string;
    latency?: number;
}

interface StatusData {
    status: string;
    timestamp: string;
    services: {
        database: ServiceStatus;
        redis: ServiceStatus;
        discord: ServiceStatus;
    };
    uptime: {
        '24h': number;
        '7d': number;
        '30d': number;
    };
    incidents: {
        active: number;
        critical: number;
        major: number;
    };
}

interface Incident {
    id: string;
    title: string;
    description: string;
    status: string;
    severity: string;
    startedAt: string;
    resolvedAt?: string;
    affectedServices: string[];
    updates: IncidentUpdate[];
}

interface IncidentUpdate {
    id: string;
    message: string;
    status?: string;
    createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
    const colors = {
        healthy: 'bg-bl-success-solid',
        operational: 'bg-bl-success-solid',
        degraded: 'bg-bl-warning-solid',
        down: 'bg-bl-danger-solid',
        unknown: 'bg-bl-recessed',
    };

    const labels = {
        healthy: 'All Systems Operational',
        operational: 'Operational',
        degraded: 'Degraded Performance',
        down: 'System Outage',
        unknown: 'Status Unknown',
    };

    return (
        <div className="flex items-center justify-center space-x-3">
            <div
                className={`h-4 w-4 rounded-full ${colors[status as keyof typeof colors] || colors.unknown}`}
            />
            <span className="text-2xl font-semibold">
                {labels[status as keyof typeof labels] || 'Unknown Status'}
            </span>
        </div>
    );
}

function ServiceCard({
    name,
    status,
    latency,
}: {
    name: string;
    status: string;
    latency?: number;
}) {
    const statusColors = {
        operational: 'border-bl-success bg-bl-success/10',
        down: 'border-bl-danger bg-bl-danger/10',
        degraded: 'border-bl-warning bg-bl-warning/10',
    };

    const statusLabels = {
        operational: 'Operational',
        down: 'Down',
        degraded: 'Degraded',
    };

    return (
        <div
            className={`border-l-4 p-4 rounded ${statusColors[status as keyof typeof statusColors] || 'border-bl-border bg-bl-panel'}`}
        >
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold capitalize">{name}</h3>
                <span className="text-sm font-medium">
                    {statusLabels[status as keyof typeof statusLabels] ||
                        'Unknown'}
                </span>
            </div>
            {latency !== undefined && latency > 0 && (
                <p className="text-sm text-bl-muted mt-1">
                    Latency: {latency}ms
                </p>
            )}
        </div>
    );
}

function UptimeStats({ uptime }: { uptime: StatusData['uptime'] }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-bl-panel p-6 rounded-lg shadow">
                <h4 className="text-sm text-bl-muted mb-2">Last 24 Hours</h4>
                <p className="text-3xl font-bold text-bl-success">
                    {uptime['24h'].toFixed(2)}%
                </p>
            </div>
            <div className="bg-bl-panel p-6 rounded-lg shadow">
                <h4 className="text-sm text-bl-muted mb-2">Last 7 Days</h4>
                <p className="text-3xl font-bold text-bl-success">
                    {uptime['7d'].toFixed(2)}%
                </p>
            </div>
            <div className="bg-bl-panel p-6 rounded-lg shadow">
                <h4 className="text-sm text-bl-muted mb-2">Last 30 Days</h4>
                <p className="text-3xl font-bold text-bl-success">
                    {uptime['30d'].toFixed(2)}%
                </p>
            </div>
        </div>
    );
}

function IncidentCard({ incident }: { incident: Incident }) {
    const severityColors = {
        MINOR: 'bg-bl-accent/10 text-bl-accent',
        MAJOR: 'bg-bl-warning/10 text-bl-warning',
        CRITICAL: 'bg-bl-danger/10 text-bl-danger',
    };

    const statusLabels = {
        INVESTIGATING: 'Investigating',
        IDENTIFIED: 'Identified',
        MONITORING: 'Monitoring',
        RESOLVED: 'Resolved',
    };

    return (
        <div className="bg-bl-panel border border-bl-border rounded-lg p-6 mb-4">
            <div className="flex justify-between items-start mb-3">
                <div>
                    <h3 className="text-xl font-semibold mb-2">
                        {incident.title}
                    </h3>
                    <div className="flex space-x-2 text-sm">
                        <span
                            className={`px-2 py-1 rounded ${severityColors[incident.severity as keyof typeof severityColors] || 'bg-bl-surface'}`}
                        >
                            {incident.severity}
                        </span>
                        <span className="px-2 py-1 rounded bg-bl-surface text-bl-ink">
                            {statusLabels[
                                incident.status as keyof typeof statusLabels
                            ] || incident.status}
                        </span>
                    </div>
                </div>
                <div className="text-right text-sm text-bl-muted">
                    <p>
                        Started: {new Date(incident.startedAt).toLocaleString()}
                    </p>
                    {incident.resolvedAt && (
                        <p>
                            Resolved:{' '}
                            {new Date(incident.resolvedAt).toLocaleString()}
                        </p>
                    )}
                </div>
            </div>

            <p className="text-bl-ink mb-4">{incident.description}</p>

            {incident.affectedServices.length > 0 && (
                <div className="mb-4">
                    <p className="text-sm font-semibold text-bl-ink mb-1">
                        Affected Services:
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {incident.affectedServices.map((service) => (
                            <span
                                key={service}
                                className="text-xs px-2 py-1 bg-bl-surface rounded capitalize"
                            >
                                {service}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {incident.updates && incident.updates.length > 0 && (
                <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold text-bl-ink mb-3">
                        Updates
                    </h4>
                    <div className="space-y-3">
                        {incident.updates.map((update) => (
                            <div key={update.id} className="text-sm">
                                <p className="text-bl-muted mb-1">
                                    {new Date(
                                        update.createdAt
                                    ).toLocaleString()}
                                    {update.status &&
                                        ` - ${statusLabels[update.status as keyof typeof statusLabels] || update.status}`}
                                </p>
                                <p className="text-bl-ink">{update.message}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Status() {
    const [status, setStatus] = useState<StatusData | null>(null);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                // Clear error state on retry
                setError(null);

                const [statusRes, incidentsRes] = await Promise.all([
                    fetch(`${apiUrl}/status`),
                    fetch(`${apiUrl}/status/incidents?resolved=false`),
                ]);

                if (!statusRes.ok || !incidentsRes.ok) {
                    throw new Error('Failed to fetch status data');
                }

                const statusData = (await statusRes.json()) as StatusData;
                const incidentsData = (await incidentsRes.json()) as {
                    incidents: Incident[];
                };

                setStatus(statusData);
                setIncidents(incidentsData.incidents);
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : 'Failed to load status'
                );
            } finally {
                setLoading(false);
            }
        };

        void fetchStatus();

        // Refresh status every 60 seconds
        const interval = setInterval(() => {
            void fetchStatus();
        }, 60000);

        return () => clearInterval(interval);
    }, [apiUrl]);

    if (loading) {
        return (
            <div className="min-h-screen bg-bl-panel flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bl-accent mx-auto"></div>
                    <p className="mt-4 text-bl-muted">Loading status...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-bl-panel flex items-center justify-center">
                <div className="text-center">
                    <p className="text-bl-danger text-xl">{error}</p>
                </div>
            </div>
        );
    }

    if (!status) {
        return null;
    }

    return (
        <div className="min-h-screen bg-bl-panel py-8">
            <div className="container mx-auto px-4 max-w-5xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-bl-ink mb-2">
                        System Status
                    </h1>
                    <p className="text-bl-muted">
                        Real-time status and uptime monitoring
                    </p>
                </div>

                {/* Overall Status */}
                <div className="bg-bl-panel rounded-lg shadow-lg p-8 mb-8">
                    <StatusBadge status={status.status} />
                    <p className="text-center text-sm text-bl-muted mt-2">
                        Last updated:{' '}
                        {new Date(status.timestamp).toLocaleString()}
                    </p>
                </div>

                {/* Services Status */}
                <div className="bg-bl-panel rounded-lg shadow-lg p-8 mb-8">
                    <h2 className="text-2xl font-bold text-bl-ink mb-4">
                        Services
                    </h2>
                    <div className="space-y-3">
                        <ServiceCard
                            name="Database"
                            status={status.services.database.status}
                            latency={status.services.database.latency}
                        />
                        <ServiceCard
                            name="Redis Cache"
                            status={status.services.redis.status}
                            latency={status.services.redis.latency}
                        />
                        <ServiceCard
                            name="Discord API"
                            status={status.services.discord.status}
                            latency={status.services.discord.latency}
                        />
                    </div>
                </div>

                {/* Uptime Statistics */}
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-bl-ink mb-4">
                        Uptime
                    </h2>
                    <UptimeStats uptime={status.uptime} />
                </div>

                {/* Active Incidents */}
                {incidents.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-bl-ink mb-4">
                            Active Incidents ({incidents.length})
                        </h2>
                        {incidents.map((incident) => (
                            <IncidentCard
                                key={incident.id}
                                incident={incident}
                            />
                        ))}
                    </div>
                )}

                {/* No Incidents Message */}
                {incidents.length === 0 && status.status === 'healthy' && (
                    <div className="bg-bl-success/10 border border-bl-success rounded-lg p-6 text-center">
                        <p className="text-bl-success font-medium">
                            ✓ No active incidents - All systems operating
                            normally
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
