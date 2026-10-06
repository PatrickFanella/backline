import { NavLink, Link, useLocation } from 'react-router-dom';

import { useTheme } from '../contexts/ThemeContext';

import { LanguageSwitcher } from './ui/LanguageSwitcher';
import { ThemeToggle } from './ui/ThemeToggle';

export default function BrandHeader() {
    const { pathname } = useLocation();
    const { effectiveTheme } = useTheme();
    if (pathname === '/') return null;
    const publicPage = ['/login', '/auth/callback', '/status'].includes(
        pathname
    );

    return (
        <header className="bl-app-header">
            <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
                <Link to="/" className="bl-app-logo" aria-label="Backline home">
                    <img
                        src={`/brand/backline/mark${effectiveTheme === 'dark' ? '-light' : ''}.svg`}
                        alt=""
                    />
                    <span>Backline</span>
                </Link>
                <nav
                    className="bl-app-nav order-3 basis-full sm:order-none sm:basis-auto"
                    aria-label="Backline navigation"
                >
                    {publicPage ? (
                        <>
                            <NavLink to="/login">Sign in</NavLink>
                            <NavLink to="/status">Status</NavLink>
                        </>
                    ) : (
                        <>
                            <NavLink to="/servers">Server setup</NavLink>
                            <NavLink to="/moderation">Moderation</NavLink>
                            <NavLink to="/observed-activity">Activity</NavLink>
                            <NavLink to="/status">Status</NavLink>
                        </>
                    )}
                </nav>
                <div className="flex items-center gap-2">
                    <LanguageSwitcher />
                    <ThemeToggle />
                </div>
            </div>
        </header>
    );
}
