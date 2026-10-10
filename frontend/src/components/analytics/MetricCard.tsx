interface MetricCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    icon?: React.ReactNode;
}

function MetricCard({ title, value, subtitle, trend, icon }: MetricCardProps) {
    return (
        <div className="bl-stat">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="bl-stat-label">{title}</p>
                    <p className="bl-stat-value mt-1">{value}</p>
                    {subtitle && (
                        <p className="bl-stat-note mt-1">{subtitle}</p>
                    )}
                    {trend && (
                        <p
                            className={`mt-2 text-sm font-medium ${
                                trend.isPositive
                                    ? 'text-bl-success'
                                    : 'text-bl-danger'
                            }`}
                        >
                            {trend.isPositive ? '↑' : '↓'}{' '}
                            {Math.abs(trend.value)}%
                        </p>
                    )}
                </div>
                {icon && (
                    <div className="ml-4 flex-shrink-0 text-bl-muted">
                        {icon}
                    </div>
                )}
            </div>
        </div>
    );
}

export default MetricCard;
