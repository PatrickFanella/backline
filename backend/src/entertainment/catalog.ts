import { z } from 'zod';

export const templateId = z.enum(['plot-twist', 'backstage-pass', 'loading']);
export const originalTemplates = {
    'plot-twist': {
        name: 'The plot twist',
        description: 'Two contrasting panels: the plan and what happened.',
        foreground: '#f8f5ed',
        background: '#172b39',
        accent: '#e57848',
    },
    'backstage-pass': {
        name: 'Backstage pass',
        description:
            'A typographic community pass with an original ticket layout.',
        foreground: '#172b39',
        background: '#f8e7b1',
        accent: '#a32836',
    },
    loading: {
        name: 'Still loading',
        description: 'A caption above an original segmented progress bar.',
        foreground: '#f8f5ed',
        background: '#242438',
        accent: '#88d0ae',
    },
} as const;
export const templateProvenance = {
    creator: 'Backline contributors',
    source: 'backend/src/entertainment/catalog.ts',
    license: 'Repository LICENSE: GNU General Public License v3',
    assets: 'Original text and geometric layouts; no imported artwork',
};
export const entertainmentConfig = z
    .object({
        approvedTemplates: z
            .array(templateId)
            .max(3)
            .default([])
            .refine(
                (v) => new Set(v).size === v.length,
                'Duplicate template approval'
            ),
        collectionsEnabled: z.boolean().default(false),
    })
    .strict();
export const originalJokes = [
    'The soundcheck lasted longer than the set. At least the cables got an encore.',
    'Our drummer keeps perfect time. Unfortunately, it belongs to a different song.',
    'The community zine is now fully wireless. We ran out of staples.',
    'I asked the mixing desk for advice. It told me to find some balance.',
];
export const eightBallAnswers = [
    'Try a smaller first step.',
    'Sleep on it and ask again.',
    'The signs point to yes.',
    'Probably, with a backup plan.',
    'The timing looks wrong.',
    'Ask someone who knows the details.',
    'Go for it.',
    'Keep your options open.',
];
