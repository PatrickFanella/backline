import { Client } from 'discord.js';

import { audioDashboardHandler } from '../../../src/audio/queue';
import { audioAccess, radioRuntime } from '../../../src/audio/radio';
import { db } from '../../../src/db';
import { authorizeGuild } from '../../../src/guilds/authorization';

jest.mock('../../../src/db', () => ({
    db: {
        user: { findUnique: jest.fn() },
        audioQueue: { findUnique: jest.fn() },
        audioPlaylist: { deleteMany: jest.fn() },
    },
}));
jest.mock('../../../src/guilds/authorization', () => ({
    authorizeGuild: jest.fn(),
}));
jest.mock('../../../src/audio/radio', () => ({
    audioAccess: jest.fn(),
    audioSettings: jest.fn(),
    radioRuntime: {
        control: jest.fn(),
        authorizedStop: jest.fn(),
        status: jest.fn(),
        play: jest.fn(),
        stop: jest.fn(),
    },
}));

const actorId = 'internal-user';
const discordId = '123456789012345678';
const baseJob = {
    id: '7005e0ce-d52d-4f16-b824-a25d6338d13c',
    guildId: '123456789012345679',
    actorId,
    payload: {
        action: 'start',
        discordId,
        requestId: '9d51438d-5acb-45e8-a071-8f60cc96e29b',
    },
};

describe('audio dashboard durable handler', () => {
    const client = {} as Client;
    const handler = audioDashboardHandler(client);

    beforeEach(() => {
        jest.clearAllMocks();
        (db.user.findUnique as jest.Mock).mockResolvedValue({
            discordId,
            role: 'USER',
        });
        (authorizeGuild as jest.Mock).mockResolvedValue(true);
    });

    it('revalidates the current dashboard account and server management before work', async () => {
        expect(await handler.authorize(baseJob as never)).toBe(true);
        expect(db.user.findUnique).toHaveBeenCalledWith({
            where: { id: actorId },
            select: { discordId: true, role: true },
        });
        expect(authorizeGuild).toHaveBeenCalledWith(actorId, baseJob.guildId);

        (db.user.findUnique as jest.Mock).mockResolvedValue({
            discordId: '223456789012345678',
            role: 'USER',
        });
        expect(await handler.authorize(baseJob as never)).toBe(false);
        expect(authorizeGuild).toHaveBeenCalledTimes(1);
    });

    it('performs playback control only after a fresh account identity check', async () => {
        const job = {
            ...baseJob,
            payload: {
                action: 'control',
                control: 'pause',
                discordId,
                requestId: '9d51438d-5acb-45e8-a071-8f60cc96e29b',
            },
        };
        (radioRuntime.control as jest.Mock).mockResolvedValue(undefined);

        expect(await handler.execute(job as never)).toEqual({
            state: 'DELIVERED',
            result: { action: 'control' },
        });
        expect(radioRuntime.control).toHaveBeenCalledWith(
            client,
            job.guildId,
            discordId,
            'pause'
        );

        (db.user.findUnique as jest.Mock).mockResolvedValue(null);
        expect(await handler.execute(job as never)).toEqual({
            state: 'CANCELLED',
            reason: 'Dashboard authorization changed',
        });
        expect(radioRuntime.control).toHaveBeenCalledTimes(1);

        (db.user.findUnique as jest.Mock).mockResolvedValue({
            discordId,
            role: 'USER',
        });
        (authorizeGuild as jest.Mock).mockResolvedValue(false);
        expect(await handler.execute(job as never)).toEqual({
            state: 'CANCELLED',
            reason: 'Dashboard authorization changed',
        });
        expect(radioRuntime.control).toHaveBeenCalledTimes(1);
    });

    it('reconciles an enqueue only when its job id is already persisted in the queue', async () => {
        const job = {
            ...baseJob,
            payload: {
                action: 'enqueue',
                station: 'defcon',
                minutes: 10,
                discordId,
                requestId: '9d51438d-5acb-45e8-a071-8f60cc96e29b',
            },
        };
        (db.audioQueue.findUnique as jest.Mock).mockResolvedValue({
            items: [
                {
                    id: job.id,
                    station: 'defcon',
                    minutes: 10,
                    requesterId: discordId,
                    channelId: '123456789012345670',
                },
            ],
        });
        expect(await handler.reconcile(job as never)).toEqual({
            state: 'DELIVERED',
            result: { action: 'enqueue' },
        });

        (db.audioQueue.findUnique as jest.Mock).mockResolvedValue(null);
        expect(await handler.reconcile(job as never)).toEqual({
            state: 'RECONCILE',
            reason: 'Audio action outcome requires current queue inspection',
        });
    });

    it('requires a current in-channel DJ before deleting a playlist', async () => {
        const job = {
            ...baseJob,
            payload: {
                action: 'playlist',
                operation: 'delete',
                name: 'Late night',
                discordId,
                requestId: '9d51438d-5acb-45e8-a071-8f60cc96e29b',
            },
        };
        (audioAccess as jest.Mock).mockResolvedValue({ channelId: 'voice' });
        (db.audioPlaylist.deleteMany as jest.Mock).mockResolvedValue({
            count: 1,
        });

        expect(await handler.execute(job as never)).toEqual({
            state: 'DELIVERED',
            result: { action: 'playlist' },
        });
        expect(audioAccess).toHaveBeenCalledWith(
            client,
            job.guildId,
            discordId,
            true
        );
        expect(db.audioPlaylist.deleteMany).toHaveBeenCalledWith({
            where: { guildId: job.guildId, name: 'Late night' },
        });
    });

    it('requires the current voice channel before dispatching a stop', async () => {
        const job = {
            ...baseJob,
            payload: {
                action: 'control',
                control: 'stop',
                discordId,
                requestId: '9d51438d-5acb-45e8-a071-8f60cc96e29b',
            },
        };
        (audioAccess as jest.Mock).mockResolvedValue({
            channelId: 'voice-one',
        });
        (radioRuntime.status as jest.Mock).mockReturnValue({
            channelId: 'voice-two',
        });

        await expect(handler.execute(job as never)).rejects.toThrow(
            'Join the current audio channel'
        );
        expect(radioRuntime.authorizedStop).not.toHaveBeenCalled();

        (radioRuntime.status as jest.Mock).mockReturnValue({
            channelId: 'voice-one',
        });
        (radioRuntime.authorizedStop as jest.Mock).mockResolvedValue(undefined);
        expect(await handler.execute(job as never)).toEqual({
            state: 'DELIVERED',
            result: { action: 'control' },
        });
        expect(radioRuntime.authorizedStop).toHaveBeenCalledWith(
            client,
            job.guildId,
            discordId
        );
    });
});
