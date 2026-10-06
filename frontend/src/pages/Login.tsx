import { motion } from 'framer-motion';
import { LogIn, Shield, Activity, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { config } from '../config/env';

function Login() {
    const { t } = useTranslation();
    const discordLoginUrl = `${config.apiUrl}/auth/discord/start`;

    return (
        <div className="flex items-center justify-center min-h-[calc(100vh-100px)] bg-bl-canvas relative">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="max-w-md w-full mx-4"
                role="main"
                aria-labelledby="login-heading"
                id="main-content"
            >
                <div className="bl-card p-8">
                    {/* Logo/Header */}
                    <header className="text-center mb-8">
                        <motion.div
                            initial={{ y: -20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="inline-flex items-center justify-center w-16 h-16 bg-bl-action rounded mb-4"
                            aria-hidden="true"
                        >
                            <img
                                src="/brand/backline/mark-light.svg"
                                alt=""
                                className="w-10 h-10"
                            />
                        </motion.div>
                        <motion.h1
                            id="login-heading"
                            initial={{ y: -20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.3 }}
                            className="text-3xl font-bold text-bl-ink mb-2"
                        >
                            Backline
                        </motion.h1>
                        <motion.p
                            initial={{ y: -20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="text-bl-muted"
                        >
                            Sign in to your pilot dashboard.
                        </motion.p>
                    </header>

                    {/* Features */}
                    <motion.ul
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="space-y-3 mb-8"
                        aria-label="Features"
                    >
                        <li className="flex items-center gap-3 text-bl-muted">
                            <Activity
                                className="w-5 h-5 text-bl-success"
                                aria-hidden="true"
                            />
                            <span className="text-sm">
                                Server setup and module configuration
                            </span>
                        </li>
                        <li className="flex items-center gap-3 text-bl-muted">
                            <Shield
                                className="w-5 h-5 text-bl-accent"
                                aria-hidden="true"
                            />
                            <span className="text-sm">
                                Moderation cases and action history
                            </span>
                        </li>
                        <li className="flex items-center gap-3 text-bl-muted">
                            <TrendingUp
                                className="w-5 h-5 text-bl-accent"
                                aria-hidden="true"
                            />
                            <span className="text-sm">
                                Welcome, roles, and private support
                            </span>
                        </li>
                    </motion.ul>

                    {/* Login Button */}
                    <motion.a
                        href={discordLoginUrl}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex items-center justify-center gap-3 w-full bg-bl-action hover:bg-bl-action/90 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors shadow-lg focus:outline-none focus:ring-2 focus:ring-bl-accent focus:ring-offset-2"
                        aria-label={t('auth.loginWithDiscord')}
                    >
                        <LogIn className="w-5 h-5" aria-hidden="true" />
                        {t('auth.loginWithDiscord')}
                    </motion.a>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.8 }}
                        className="text-center text-xs text-bl-muted mt-6"
                    >
                        {t('auth.termsAgreement')}
                    </motion.p>
                </div>
            </motion.div>
        </div>
    );
}

export default Login;
