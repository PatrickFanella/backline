/**
 * Analytics Consent Banner Component
 * GDPR-compliant cookie consent banner
 */

import { X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAnalytics } from '../hooks/useAnalytics';

export default function AnalyticsConsentBanner() {
    const { t } = useTranslation();
    const [isVisible, setIsVisible] = useState(false);
    const { consentStatus, grantConsent, denyConsent } = useAnalytics();

    useEffect(() => {
        // Show banner only if consent is pending
        if (consentStatus === 'pending') {
            setIsVisible(true);
        }
    }, [consentStatus]);

    const handleAccept = () => {
        grantConsent();
        setIsVisible(false);
    };

    const handleDeny = () => {
        denyConsent();
        setIsVisible(false);
    };

    if (!isVisible) {
        return null;
    }

    return (
        <aside
            aria-labelledby="consent-heading"
            className="fixed bottom-0 left-0 right-0 z-50 bg-bl-recessed border-t border-bl-border shadow-lg"
        >
            <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1">
                        <h3
                            id="consent-heading"
                            className="text-lg font-semibold text-bl-ink mb-1"
                        >
                            <span aria-hidden="true">🍪</span>{' '}
                            {t('consent.analyticsTitle')}
                        </h3>
                        <p className="text-sm text-bl-muted">
                            {t('consent.analyticsMessage')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDeny}
                            className="bl-button bl-button-secondary bl-button-sm"
                            aria-label={t('consent.decline')}
                        >
                            {t('consent.decline')}
                        </button>
                        <button
                            onClick={handleAccept}
                            className="bl-button bl-button-primary bl-button-sm"
                            aria-label={t('consent.accept')}
                        >
                            {t('consent.accept')}
                        </button>
                        <button
                            onClick={handleDeny}
                            className="p-2 text-bl-muted hover:text-bl-ink transition-colors rounded"
                            aria-label={t('common.close')}
                        >
                            <X className="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
}
