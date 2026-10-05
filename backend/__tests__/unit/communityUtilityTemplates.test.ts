import {
    customCommandsConfig,
    renderCustomResponse,
} from '../../src/community/utilityTemplates';
import { resolveLocalTime } from '../../src/community/utilityTime';

describe('fixed custom reply templates', () => {
    it('renders only fixed names and disables all mentions', () => {
        const response = renderCustomResponse(
            {
                content:
                    'Hello {user} in {server} / {channel} @everyone <@123>',
                title: '{server}',
                description: 'Welcome {user}.',
            },
            { user: 'Member', server: 'Fixture', channel: 'general' }
        );
        expect(response.content).toBe(
            'Hello Member in Fixture / general @everyone <@123>'
        );
        expect(response.allowedMentions).toEqual({
            parse: [],
            repliedUser: false,
        });
        expect(response.embeds).toEqual([
            { title: 'Fixture', description: 'Welcome Member.' },
        ]);
    });
    it('rejects executable substitutions and preserves literal code as inert text', () => {
        expect(() =>
            renderCustomResponse(
                { content: '{process.exit()}' },
                { user: '', server: '', channel: '' }
            )
        ).toThrow();
        expect(
            renderCustomResponse(
                { content: 'process.exit(); require("fs")' },
                { user: '', server: '', channel: '' }
            ).content
        ).toBe('process.exit(); require("fs")');
        expect(
            customCommandsConfig.safeParse({
                commands: [
                    {
                        name: 'safe',
                        response: { content: 'reply', executable: 'bad' },
                    },
                ],
            }).success
        ).toBe(false);
    });
    it('bounds expanded replies and rejects duplicate names, invalid names and empty replies', () => {
        const values = {
            user: 'x'.repeat(1000),
            server: 'y'.repeat(1000),
            channel: 'z'.repeat(1000),
        };
        const result = renderCustomResponse(
            {
                content: '{user}'.repeat(20),
                title: '{server}',
                description: '{channel}'.repeat(10),
            },
            values
        );
        expect(result.content?.length).toBe(2000);
        expect(result.embeds?.[0].title?.length).toBe(256);
        expect(result.embeds?.[0].description?.length).toBe(4096);
        const command = { name: 'rules', response: { content: 'Useful text' } };
        expect(
            customCommandsConfig.safeParse({ commands: [command, command] })
                .success
        ).toBe(false);
        expect(
            customCommandsConfig.safeParse({
                commands: [{ ...command, name: 'bad name' }],
            }).success
        ).toBe(false);
        expect(
            customCommandsConfig.safeParse({
                commands: [{ ...command, response: {} }],
            }).success
        ).toBe(false);
    });
});
describe('IANA local scheduling and daylight saving', () => {
    it('converts UTC and fractional-offset zones without depending on the host time zone', () => {
        expect(
            resolveLocalTime({
                local: '2026-10-05T09:30',
                timeZone: 'UTC',
            }).toISOString()
        ).toBe('2026-10-05T09:30:00.000Z');
        expect(
            resolveLocalTime({
                local: '2026-10-05T09:30',
                timeZone: 'Asia/Kathmandu',
            }).toISOString()
        ).toBe('2026-10-05T03:45:00.000Z');
    });
    it('rejects a missing spring-forward local minute', () => {
        expect(() =>
            resolveLocalTime({
                local: '2026-03-08T02:30',
                timeZone: 'America/New_York',
            })
        ).toThrow('does not exist');
    });
    it('requires explicit selection for a repeated fall-back minute', () => {
        const local = {
            local: '2026-11-01T01:30',
            timeZone: 'America/New_York',
        };
        expect(() => resolveLocalTime(local)).toThrow('occurs twice');
        expect(
            resolveLocalTime({
                ...local,
                disambiguation: 'earlier',
            }).toISOString()
        ).toBe('2026-11-01T05:30:00.000Z');
        expect(
            resolveLocalTime({
                ...local,
                disambiguation: 'later',
            }).toISOString()
        ).toBe('2026-11-01T06:30:00.000Z');
    });
    it('rejects calendar overflow and unknown time zones', () => {
        expect(() =>
            resolveLocalTime({ local: '2026-02-30T12:00', timeZone: 'UTC' })
        ).toThrow('Invalid local');
        expect(() =>
            resolveLocalTime({
                local: '2026-10-05T12:00',
                timeZone: 'Invalid/Timezone',
            })
        ).toThrow('Unknown IANA');
    });
});
