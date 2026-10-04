import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';

import {
    AudioPlayer,
    AudioPlayerStatus,
    AudioResource,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
    NetworkingStatusCode,
    NoSubscriberBehavior,
    StreamType,
    VoiceConnection,
    VoiceConnectionStatus,
} from '@discordjs/voice';
import {
    ChannelType,
    Client,
    GuildMember,
    Interaction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';

import { db } from '../db';
import { moduleRegistry } from '../modules/registry';

import { audioConfig, stationId } from './config';
import { radioSource } from './sources';
import { somaStations } from './stations';

type Config = ReturnType<typeof audioConfig.parse>;
type Session = {
    id: string;
    channelId: string;
    requesterId: string;
    stationId: string;
    connection: VoiceConnection;
    player: AudioPlayer;
    resource?: AudioResource;
    controller: AbortController;
    source?: Readable;
    process?: ChildProcessWithoutNullStreams;
    stopping: boolean;
    timer?: NodeJS.Timeout;
    monitor?: NodeJS.Timeout;
    idleAt?: number;
    monitoring: boolean;
    rejoining: boolean;
    config: Config;
};
export function isDJ(member: GuildMember, config: Config): boolean {
    return (
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        config.djRoles.some((role) => member.roles.cache.has(role))
    );
}
async function settings(guildId: string): Promise<Config> {
    if (!(await moduleRegistry.enabled(guildId, 'audio')))
        throw new Error('Audio disabled or voice intent unavailable');
    const row = await db.guildModuleConfig.findUniqueOrThrow({
        where: { guildId_moduleId: { guildId, moduleId: 'audio' } },
    });
    return audioConfig.parse(row.config);
}
export class RadioRuntime {
    private readonly sessions = new Map<string, Session>();
    private readonly pending = new Set<string>();
    status(guildId: string) {
        const row = this.sessions.get(guildId);
        return row
            ? {
                  id: row.id,
                  channelId: row.channelId,
                  stationId: row.stationId,
                  player: row.player.state.status,
                  connection: row.connection.state.status,
                  playbackMs: row.resource?.playbackDuration ?? 0,
              }
            : null;
    }
    async recover(guildIds: string[]): Promise<void> {
        if (!guildIds.length) return;
        await db.voicePlayback.updateMany({
            where: {
                guildId: { in: guildIds },
                state: { in: ['STARTING', 'PLAYING'] },
            },
            data: {
                state: 'INTERRUPTED',
                detail: 'Runtime restarted; explicitly start playback again',
                finishedAt: new Date(),
            },
        });
        await this.expireHistory();
    }
    async expireHistory(): Promise<void> {
        await db.voicePlayback.deleteMany({
            where: {
                startedAt: { lt: new Date(Date.now() - 90 * 86400000) },
                state: { notIn: ['STARTING', 'PLAYING'] },
            },
        });
    }
    async play(
        client: Client,
        guildId: string,
        actorId: string,
        station?: string,
        requestedChannel?: string
    ) {
        if (this.pending.has(guildId))
            throw new Error('Radio startup already in progress');
        if (
            !this.sessions.has(guildId) &&
            this.sessions.size + this.pending.size >= 3
        )
            throw new Error('Operator voice capacity reached');
        this.pending.add(guildId);
        let session: Session | undefined;
        let reservedId: string | undefined;
        try {
            const config = await settings(guildId);
            const selected = stationId.parse(station ?? config.defaultStation);
            const guild = await client.guilds.fetch({
                guild: guildId,
                force: true,
            });
            const actor = await guild.members.fetch({
                user: actorId,
                force: true,
            });
            const dj = isDJ(actor, config);
            if (config.djRoles.length && !dj)
                throw new Error('Current DJ role required');
            const channelId = requestedChannel ?? actor.voice.channelId;
            if (!channelId || (actor.voice.channelId !== channelId && !dj))
                throw new Error('Join the intended voice channel first');
            const channel = await guild.channels.fetch(channelId);
            if (!channel || channel.type !== ChannelType.GuildVoice)
                throw new Error('Voice channel unavailable');
            const bot = await guild.members.fetchMe({ force: true });
            if (
                !channel
                    .permissionsFor(actor)
                    ?.has(PermissionFlagsBits.ViewChannel) ||
                !channel
                    .permissionsFor(bot)
                    ?.has([
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                    ])
            )
                throw new Error('Current voice permissions denied');
            if (this.sessions.has(guildId)) {
                const existing = this.sessions.get(guildId)!;
                if (existing.requesterId !== actorId && !dj)
                    throw new Error(
                        'Only the requester or a DJ may replace playback'
                    );
                await this.stop(guildId, 'Replaced by authorized request');
            }
            if (this.sessions.size >= 3)
                throw new Error('Operator voice capacity reached');
            if (
                (await db.voicePlayback.count({
                    where: {
                        guildId,
                        startedAt: {
                            gte: new Date(Date.now() - 90 * 86400000),
                        },
                    },
                })) >= 1000
            )
                throw new Error('Server voice history capacity reached');
            const record = await db.voicePlayback.create({
                data: {
                    guildId,
                    channelId,
                    requesterId: actorId,
                    stationId: selected,
                },
            });
            reservedId = record.id;
            const connection = joinVoiceChannel({
                guildId,
                channelId,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: false,
                group: 'backline',
                daveEncryption: true,
            });
            const player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
            });
            session = {
                id: record.id,
                channelId,
                requesterId: actorId,
                stationId: selected,
                connection,
                player,
                controller: new AbortController(),
                stopping: false,
                monitoring: false,
                rejoining: false,
                config,
            };
            this.sessions.set(guildId, session);
            const stopFailed = () => {
                void this.stop(
                    guildId,
                    'Voice or source failed',
                    'FAILED',
                    record.id
                ).catch(() =>
                    console.warn('Radio failure recording unavailable')
                );
            };
            connection.on('error', stopFailed);
            player.on('error', stopFailed);
            connection.on(VoiceConnectionStatus.Disconnected, () => {
                if (!session || session.stopping || session.rejoining) return;
                session.rejoining = true;
                void (async () => {
                    // Wait for native resume/rejoin before making a bounded recovery attempt.
                    try {
                        await entersState(
                            connection,
                            VoiceConnectionStatus.Ready,
                            5000
                        );
                    } catch {
                        if (!session.stopping) {
                            connection.rejoin();
                            await entersState(
                                connection,
                                VoiceConnectionStatus.Ready,
                                10000
                            );
                        }
                    }
                })()
                    .catch(stopFailed)
                    .finally(() => {
                        if (session) session.rejoining = false;
                    });
            });
            player.on(AudioPlayerStatus.Idle, () => {
                if (session?.resource && !session.stopping) stopFailed();
            });
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            const network =
                connection.state.status === VoiceConnectionStatus.Ready
                    ? connection.state.networking.state
                    : null;
            const dave =
                network && network.code === NetworkingStatusCode.Ready
                    ? network.dave?.protocolVersion
                    : null;
            if (!dave || dave < 1) throw new Error('DAVE session unavailable');
            const source = await radioSource(selected, session.controller);
            session.source = source.stream;
            const child = spawn(
                'ffmpeg',
                [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-nostdin',
                    '-protocol_whitelist',
                    'pipe',
                    '-i',
                    'pipe:0',
                    '-vn',
                    '-f',
                    's16le',
                    '-ar',
                    '48000',
                    '-ac',
                    '2',
                    'pipe:1',
                ],
                { stdio: ['pipe', 'pipe', 'pipe'] }
            );
            session.process = child;
            child.stderr.resume(); // Never include provider data or arbitrary process output in application logs.
            child.on('error', stopFailed);
            child.on('exit', () => {
                if (!session?.stopping) stopFailed();
            });
            child.stdin.on('error', stopFailed);
            child.stdout.on('error', stopFailed);
            source.stream.on('error', stopFailed);
            source.stream.pipe(child.stdin);
            const resource = createAudioResource(child.stdout, {
                inputType: StreamType.Raw,
                inlineVolume: true,
            });
            resource.volume?.setVolume(config.volume / 100);
            session.resource = resource;
            connection.subscribe(player);
            player.play(resource);
            await entersState(player, AudioPlayerStatus.Playing, 15000);
            if (session.stopping) throw new Error('Radio startup interrupted');
            await db.voicePlayback.update({
                where: { id: record.id },
                data: { state: 'PLAYING', daveProtocol: dave },
            });
            session.timer = setTimeout(() => {
                void this.stop(
                    guildId,
                    'Maximum playback duration reached',
                    'STOPPED',
                    record.id
                ).catch(() => console.warn('Radio stop recording failed'));
            }, config.maxMinutes * 60000);
            session.monitor = setInterval(() => {
                if (!session || session.monitoring || session.stopping) return;
                session.monitoring = true;
                void (async () => {
                    if (!(await moduleRegistry.enabled(guildId, 'audio'))) {
                        await this.stop(
                            guildId,
                            'Audio disabled',
                            'STOPPED',
                            record.id
                        );
                        return;
                    }
                    const current = await settings(guildId);
                    const currentActor = await guild.members.fetch({
                        user: actorId,
                        force: true,
                    });
                    if (
                        current.djRoles.length &&
                        !isDJ(currentActor, current)
                    ) {
                        await this.stop(
                            guildId,
                            'Requester DJ access revoked',
                            'STOPPED',
                            record.id
                        );
                        return;
                    }
                    const currentBot = await guild.members.fetchMe({
                        force: true,
                    });
                    const liveChannel = await guild.channels.fetch(channelId);
                    if (
                        !liveChannel ||
                        liveChannel.type !== ChannelType.GuildVoice ||
                        !liveChannel
                            .permissionsFor(currentBot)
                            ?.has([
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.Speak,
                            ])
                    ) {
                        await this.stop(
                            guildId,
                            'Voice permission revoked',
                            'STOPPED',
                            record.id
                        );
                        return;
                    }
                    const listeners = liveChannel.members.filter(
                        (member) => !member.user.bot
                    );
                    if (!listeners.size) {
                        session.idleAt ??= Date.now();
                        if (
                            Date.now() - session.idleAt >=
                            current.idleSeconds * 1000
                        ) {
                            await this.stop(
                                guildId,
                                'Voice channel empty',
                                'STOPPED',
                                record.id
                            );
                            return;
                        }
                    } else session.idleAt = undefined;
                    resource.volume?.setVolume(
                        Math.min(current.volume, session.config.volume) / 100
                    );
                    await db.voicePlayback.updateMany({
                        where: { id: record.id, state: 'PLAYING' },
                        data: { playbackMs: resource.playbackDuration },
                    });
                })()
                    .catch(stopFailed)
                    .finally(() => {
                        if (session) session.monitoring = false;
                    });
            }, 5000);
            return this.status(guildId);
        } catch {
            if (session)
                await this.stop(guildId, 'Radio startup failed', 'FAILED');
            else if (reservedId)
                await db.voicePlayback.update({
                    where: { id: reservedId },
                    data: {
                        state: 'FAILED',
                        detail: 'Connection initialization failed',
                        finishedAt: new Date(),
                    },
                });
            throw new Error(
                'Radio could not start. Check permissions, voice intent, DAVE and the station connection.'
            );
        } finally {
            this.pending.delete(guildId);
        }
    }
    async authorizedStop(client: Client, guildId: string, actorId: string) {
        const session = this.sessions.get(guildId);
        if (!session) return;
        const config = await settings(guildId),
            guild = await client.guilds.fetch(guildId);
        const actor = await guild.members.fetch({ user: actorId, force: true });
        if (actorId !== session.requesterId && !isDJ(actor, config))
            throw new Error('Only the requester or a DJ may stop playback');
        await this.stop(
            guildId,
            'Stopped by authorized member',
            'STOPPED',
            session.id
        );
    }
    async stop(
        guildId: string,
        detail = 'Stopped',
        state = 'STOPPED',
        expectedId?: string
    ): Promise<void> {
        const session = this.sessions.get(guildId);
        if (
            !session ||
            session.stopping ||
            (expectedId && session.id !== expectedId)
        )
            return;
        session.stopping = true;
        clearTimeout(session.timer);
        clearInterval(session.monitor);
        const playbackMs = session.resource?.playbackDuration ?? 0;
        session.controller.abort();
        session.source?.destroy();
        session.player.stop(true);
        session.process?.kill('SIGTERM');
        if (session.process) {
            const child = session.process;
            const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
            killTimer.unref();
            child.once('close', () => clearTimeout(killTimer));
        }
        if (session.connection.state.status !== VoiceConnectionStatus.Destroyed)
            session.connection.destroy();
        this.sessions.delete(guildId);
        await db.voicePlayback.update({
            where: { id: session.id },
            data: { state, detail, finishedAt: new Date(), playbackMs },
        });
    }
    async shutdown() {
        for (const guildId of [...this.sessions.keys()])
            await this.stop(guildId, 'Runtime stopped');
    }
}
export const radioRuntime = new RadioRuntime();
export const radioCommand = new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Play an approved SomaFM station')
    .setContexts(0)
    .setIntegrationTypes(0)
    .addSubcommand((sub) =>
        sub
            .setName('play')
            .setDescription('Start SomaFM radio in your voice channel')
            .addStringOption((option) =>
                option
                    .setName('station')
                    .setDescription(
                        'SomaFM station ID, such as defcon or groovesalad'
                    )
            )
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription(
                        'DJ destination; otherwise your current voice channel'
                    )
                    .addChannelTypes(ChannelType.GuildVoice)
            )
    )
    .addSubcommand((sub) =>
        sub.setName('stop').setDescription('Stop your radio session')
    )
    .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show actual playback state')
    )
    .addSubcommand((sub) =>
        sub
            .setName('stations')
            .setDescription('List published SomaFM station IDs')
    )
    .toJSON();
export async function routeRadio(interaction: Interaction): Promise<boolean> {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'radio'
    )
        return false;
    const guildId = interaction.guildId!,
        kind = interaction.options.getSubcommand();
    if (kind === 'play') {
        const result = await radioRuntime.play(
            interaction.client,
            guildId,
            interaction.user.id,
            interaction.options.getString('station') ?? undefined,
            interaction.options.getChannel('channel')?.id
        );
        await interaction.editReply(
            `Radio ${result?.player}: ${somaStations[result!.stationId].title}. Source: https://somafm.com/${result!.stationId}/`
        );
    } else if (kind === 'stop') {
        await radioRuntime.authorizedStop(
            interaction.client,
            guildId,
            interaction.user.id
        );
        await interaction.editReply('Radio stopped.');
    } else if (kind === 'status') {
        const result = radioRuntime.status(guildId);
        await interaction.editReply(
            result
                ? `Radio ${result.player}; connection ${result.connection}; ${result.playbackMs} ms processed.`
                : 'No radio session is running.'
        );
    } else if (kind === 'stations')
        await interaction.editReply(
            Object.entries(somaStations)
                .map(([station, value]) => `${station}: ${value.title}`)
                .join('\n')
                .slice(0, 1950)
        );
    return true;
}
