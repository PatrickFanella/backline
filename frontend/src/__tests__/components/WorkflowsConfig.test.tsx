import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkflowsConfig from '../../components/WorkflowsConfig';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
describe('workflow editor', () => {
    it('saves the rule without enabling or trusting an actor ID', async () => {
        vi.mocked(api.get).mockResolvedValue({ data: [] });
        vi.mocked(api.put).mockResolvedValue({ data: {} });
        render(
            <WorkflowsConfig
                guildId="guild-one"
                enabled={false}
                config={{
                    rules: [
                        {
                            id: 'rule-one',
                            actorId: 'forged',
                            trigger: 'manual',
                            channelId: '777777777777777864',
                            message: 'Hello',
                            provider: 'any',
                            contains: '',
                            requiredRole: null,
                            cooldownSeconds: 60,
                        },
                    ],
                }}
                onSaved={vi.fn().mockResolvedValue(undefined)}
                onBusy={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText('Save workflows'));
        expect(await screen.findByText(/Workflows saved/)).toBeInTheDocument();
        const body = vi.mocked(api.put).mock.calls[0][1] as {
            enabled: boolean;
            config: { rules: Record<string, unknown>[] };
        };
        expect(body.enabled).toBe(false);
        expect(body.config.rules[0]).not.toHaveProperty('actorId');
    });
    it('distinguishes a skipped trigger from an uncertain delivery', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                {
                    id: 'run-one',
                    ruleId: 'rule-one',
                    state: 'SKIPPED',
                    delivery: null,
                },
                {
                    id: 'run-two',
                    ruleId: 'rule-two',
                    state: 'UNCERTAIN',
                    delivery: { state: 'RECONCILE' },
                },
            ],
        });
        render(
            <WorkflowsConfig
                guildId="guild-one"
                enabled={false}
                config={{}}
                onSaved={vi.fn()}
                onBusy={vi.fn()}
            />
        );
        expect(
            await screen.findByText(/rule-one: SKIPPED/)
        ).toBeInTheDocument();
        expect(screen.getByText(/uncertain send is held/)).toBeInTheDocument();
    });
});
