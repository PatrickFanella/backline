import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '../components/ui/Badge';
import { config } from '../config/env';
import { useTheme } from '../contexts/ThemeContext';

const abilities = [
    { tag: 'Setup', text: 'Server setup and module configuration' },
    { tag: 'Cases', text: 'Moderation cases and action history' },
    { tag: 'Support', text: 'Welcome, roles, and private support' },
];

function Login() {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const discordLoginUrl = `${config.apiUrl}/auth/discord/start`;

    return (
        <main
            id="main-content"
            className="bl-page flex items-center justify-center"
            aria-labelledby="login-heading"
        >
            <div className="w-full max-w-md space-y-4">
                <div className="bl-card p-8 space-y-6">
                    <header className="space-y-3">
                        <p className="bl-eyebrow-app">
                            Private pilot · Sign in
                        </p>
                        <div className="flex items-center gap-3">
                            <img
                                src={`/brand/backline/mark${effectiveTheme === 'dark' ? '-light' : ''}.svg`}
                                alt=""
                                width={44}
                                height={44}
                            />
                            <h1
                                id="login-heading"
                                className="text-4xl uppercase leading-none"
                            >
                                Backline
                            </h1>
                        </div>
                        <p className="text-bl-muted">
                            Sign in with Discord to manage the servers where you
                            have Manage Server permission.
                        </p>
                    </header>

                    <ul
                        className="space-y-3"
                        aria-label="What the dashboard covers"
                    >
                        {abilities.map((item) => (
                            <li
                                key={item.tag}
                                className="flex items-center gap-3 text-sm"
                            >
                                <Badge tone="accent">{item.tag}</Badge>
                                <span>{item.text}</span>
                            </li>
                        ))}
                    </ul>

                    <a
                        href={discordLoginUrl}
                        className="bl-button bl-button-primary w-full text-lg"
                        aria-label={t('auth.loginWithDiscord')}
                    >
                        <LogIn className="w-5 h-5" aria-hidden="true" />
                        {t('auth.loginWithDiscord')}
                    </a>

                    <p className="text-center text-xs text-bl-muted">
                        {t('auth.termsAgreement')}
                    </p>
                </div>
                <p className="text-center text-sm text-bl-muted">
                    <Link to="/" className="text-bl-accent">
                        About Backline
                    </Link>
                    {' · '}
                    <Link to="/status" className="text-bl-accent">
                        Service status
                    </Link>
                </p>
            </div>
        </main>
    );
}

export default Login;
