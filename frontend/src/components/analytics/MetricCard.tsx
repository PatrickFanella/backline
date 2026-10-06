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
        <div className="bg-bl-panel dark:bg-bl-recessed rounded-lg shadow p-6 border border-bl-border dark:border-bl-border">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-sm font-medium text-bl-muted dark:text-bl-muted">
                        {title}
                    </p>
                    <p className="mt-2 text-3xl font-bold text-bl-ink dark:text-white">
                        {value}
                    </p>
                    {subtitle && (
                        <p className="mt-1 text-sm text-bl-muted dark:text-bl-muted">
                            {subtitle}
                        </p>
                    )}
                    {trend && (
                        <p
                            className={`mt-2 text-sm font-medium ${
                                trend.isPositive
                                    ? 'text-bl-success dark:text-bl-success'
                                    : 'text-bl-danger dark:text-bl-danger'
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
