/** Display names, grouping and short guidance for server modules. Ids come from the backend registry. */

export type ModuleCategory = {
    id: string;
    title: string;
    description: string;
};

export const moduleCategories: ModuleCategory[] = [
    {
        id: 'community',
        title: 'Welcome and community',
        description: 'How members arrive, pick roles and take part.',
    },
    {
        id: 'safety',
        title: 'Safety and records',
        description: 'Moderation, logs, support tickets and observed activity.',
    },
    {
        id: 'engagement',
        title: 'Engagement',
        description: 'Levels, giveaways, play and voice audio.',
    },
    {
        id: 'automation',
        title: 'Automation and recovery',
        description:
            'Scheduled posts, feeds, workflows, commands and snapshots.',
    },
    {
        id: 'operator',
        title: 'Operator extensions',
        description: 'Features installed by the bot operator.',
    },
];

const catalog: Record<string, { name: string; category: string }> = {
    onboarding: { name: 'Onboarding', category: 'community' },
    'self-roles': { name: 'Self-assigned roles', category: 'community' },
    birthdays: { name: 'Birthdays', category: 'community' },
    afk: { name: 'AFK status', category: 'community' },
    suggestions: { name: 'Suggestions', category: 'community' },
    polls: { name: 'Polls', category: 'community' },
    'community-reports': { name: 'Community reports', category: 'community' },
    moderation: { name: 'Moderation', category: 'safety' },
    'anti-spam': { name: 'Anti-spam', category: 'safety' },
    'audit-log': { name: 'Audit log', category: 'safety' },
    tickets: { name: 'Private tickets', category: 'safety' },
    activity: { name: 'Activity reports', category: 'safety' },
    leveling: { name: 'Leveling', category: 'engagement' },
    giveaways: { name: 'Giveaways', category: 'engagement' },
    economy: { name: 'Economy', category: 'engagement' },
    entertainment: { name: 'Entertainment', category: 'engagement' },
    audio: { name: 'Audio', category: 'engagement' },
    'scheduled-utilities': {
        name: 'Scheduled utilities',
        category: 'automation',
    },
    'custom-commands': { name: 'Custom commands', category: 'automation' },
    integrations: { name: 'Integrations', category: 'automation' },
    workflows: { name: 'Workflows', category: 'automation' },
    recovery: { name: 'Recovery', category: 'automation' },
    'operator-plugins': { name: 'Extensions', category: 'operator' },
};

export function moduleName(id: string): string {
    const entry = catalog[id];
    if (entry) return entry.name;
    const words = id.replace(/-/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export function moduleCategory(id: string): string {
    return catalog[id]?.category ?? 'operator';
}

export type ModuleState = 'enabled' | 'disabled' | 'blocked';

export function moduleState(
    settings: { enabled: boolean },
    operatorReady: boolean
): ModuleState {
    if (settings.enabled) return 'enabled';
    return operatorReady ? 'disabled' : 'blocked';
}

/** Modules whose card has a settings or history panel. Others only have the enable control. */
const withSettings = new Set([
    'afk',
    'anti-spam',
    'audio',
    'audit-log',
    'birthdays',
    'community-reports',
    'custom-commands',
    'economy',
    'entertainment',
    'giveaways',
    'integrations',
    'leveling',
    'onboarding',
    'polls',
    'recovery',
    'scheduled-utilities',
    'self-roles',
    'suggestions',
    'tickets',
    'workflows',
]);

export function hasModuleSettings(id: string): boolean {
    return withSettings.has(id);
}
