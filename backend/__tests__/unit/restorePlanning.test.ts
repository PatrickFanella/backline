import { PermissionFlagsBits } from 'discord.js';

import { buildRestoreOperations } from '../../src/recovery/restore';

const guildId = '777777777777777861',
    roleId = '777777777777777867',
    botId = '777777777777777868';
const role = {
    id: roleId,
    name: 'Members',
    color: 0,
    permissions: PermissionFlagsBits.SendMessages.toString(),
    position: 1,
    managed: false,
    hoist: false,
    mentionable: false,
};
const source = {
    version: 1 as const,
    guildId,
    name: 'Fixture',
    capturedAt: '2026-10-05T00:00:00.000Z',
    roles: [role],
    channels: [],
};
describe('restore protection', () => {
    it('skips managed, privileged and above-bot roles', () => {
        for (const change of [
            { managed: true },
            { permissions: PermissionFlagsBits.Administrator.toString() },
            { permissions: PermissionFlagsBits.ManageRoles.toString() },
            { position: 10 },
        ]) {
            const live = { ...source, roles: [{ ...role, ...change }] };
            const desired = change.position ? source : live;
            expect(
                buildRestoreOperations(
                    desired,
                    live,
                    [roleId],
                    [],
                    botId,
                    10,
                    [],
                    []
                )[0].action
            ).toBe('SKIP');
        }
    });
    it('rejects another server and invalid selections', () => {
        expect(() =>
            buildRestoreOperations(
                source,
                { ...source, guildId: '777777777777777862' },
                [],
                [],
                botId,
                10,
                [],
                []
            )
        ).toThrow('another server');
        expect(() =>
            buildRestoreOperations(
                source,
                source,
                ['unknown'],
                [],
                botId,
                10,
                [],
                []
            )
        ).toThrow('known resource');
        expect(() =>
            buildRestoreOperations(
                source,
                source,
                [roleId, roleId],
                [],
                botId,
                10,
                [],
                []
            )
        ).toThrow();
    });
    it('preserves explicit protection after target ID mapping', () => {
        const targetId = '777777777777777866';
        expect(
            buildRestoreOperations(
                source,
                { ...source, roles: [{ ...role, id: targetId }] },
                [roleId],
                [{ kind: 'role', sourceId: roleId, targetId }],
                botId,
                10,
                [],
                [targetId]
            )[0].action
        ).toBe('SKIP');
    });
});
