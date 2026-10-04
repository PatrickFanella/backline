import { Server as HttpServer } from 'http';
import { AddressInfo } from 'net';

import ioClient from 'socket.io-client';

import { authorizeGuild } from '../../../src/guilds/authorization';
import { WebSocketService } from '../../../src/services/websocket';
import { generateAccessToken } from '../../../src/utils/auth';

jest.mock('../../../src/guilds/authorization', () => ({
    authorizeGuild: jest.fn(),
}));
jest.mock('../../../src/utils/redis', () => ({ getRedisClient: () => null }));

type ClientSocket = any;

describe('WebSocketService', () => {
    let httpServer: HttpServer;
    let websocketService: WebSocketService;
    let clientSocket: ClientSocket;
    let serverPort: number;

    beforeEach((done) => {
        (authorizeGuild as jest.Mock).mockResolvedValue(true);
        httpServer = new HttpServer();
        websocketService = new WebSocketService();
        websocketService.setupWebSocket(httpServer);
        httpServer.listen(0, '127.0.0.1', () => {
            serverPort = (httpServer.address() as AddressInfo).port;
            done();
        });
    });

    afterEach(async () => {
        clientSocket?.disconnect();
        const io = websocketService.getIO();
        if (io)
            await new Promise<void>((resolve) => {
                void io.close(() => {
                    resolve();
                });
            });
    });

    describe('setupWebSocket', () => {
        it('should initialize WebSocket server', () => {
            const io = websocketService.getIO();
            expect(io).toBeDefined();
            expect(io).not.toBeNull();
        });

        it('should accept authenticated connections', (done) => {
            const token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                expect(clientSocket.connected).toBe(true);
                done();
            });

            clientSocket.on('connect_error', (error: Error) => {
                done(error);
            });
        });

        it('should reject unauthenticated connections', (done) => {
            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token: null },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                done(new Error('Should not connect without token'));
            });

            clientSocket.on('connect_error', (error: Error) => {
                expect(error.message).toContain('Authentication required');
                done();
            });
        });

        it('should reject invalid tokens', (done) => {
            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token: 'invalid-token' },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                done(new Error('Should not connect with invalid token'));
            });

            clientSocket.on('connect_error', (error: Error) => {
                expect(error.message).toContain('Invalid token');
                done();
            });
        });
    });

    describe('Room subscriptions', () => {
        let token: string;

        beforeEach((done) => {
            token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                done();
            });
        });

        it('denies subscriptions to another server', (done) => {
            (authorizeGuild as jest.Mock).mockResolvedValue(false);
            clientSocket.once('error', (data: { message: string }) => {
                expect(data.message).toContain('access required');
                done();
            });
            clientSocket.emit('subscribe:guild', '987654321');
        });

        it('withholds events and leaves the room after access revocation', (done) => {
            let received = false;
            clientSocket.on('message:new', () => {
                received = true;
            });
            clientSocket.once('subscription:ready', () => {
                (authorizeGuild as jest.Mock).mockResolvedValue(false);
                clientSocket.once('error', (data: { message: string }) => {
                    expect(data.message).toContain('revoked');
                    expect(received).toBe(false);
                    const sockets = websocketService.getIO()!.sockets.sockets;
                    expect(
                        [...sockets.values()].every(
                            (socket) => !socket.rooms.has('guild:123456789')
                        )
                    ).toBe(true);
                    done();
                });
                websocketService.emitToRoom('guild:123456789', 'message:new', {
                    private: true,
                });
            });
            clientSocket.emit('subscribe:guild', '123456789');
        });

        it('should allow subscribing to analytics room', (done) => {
            const guildId = '123456789';

            clientSocket.emit('subscribe:analytics', guildId);

            // Give some time for subscription to process
            setTimeout(() => {
                // Emit event to analytics room
                websocketService.emitAnalyticsUpdate(guildId, {
                    test: 'data',
                });

                clientSocket.on(
                    'analytics:update',

                    (data: any) => {
                        expect(data).toBeDefined();
                        expect(data.guildId).toBe(guildId);
                        done();
                    }
                );
            }, 100);
        });

        it('should allow subscribing to guild room', (done) => {
            const guildId = '123456789';

            clientSocket.emit('subscribe:guild', guildId);

            // Give some time for subscription to process
            setTimeout(() => {
                // Emit event to guild room
                websocketService.emitNewMessage(guildId, {
                    userId: 'user-1',
                    username: 'TestUser',
                    channelId: 'channel-1',
                    channelName: 'general',
                    timestamp: new Date(),
                });

                clientSocket.on(
                    'message:new',

                    (data: any) => {
                        expect(data).toBeDefined();
                        expect(data.username).toBe('TestUser');
                        done();
                    }
                );
            }, 100);
        });

        it('should allow unsubscribing from analytics room', (done) => {
            const guildId = '123456789';

            clientSocket.emit('subscribe:analytics', guildId);

            setTimeout(() => {
                clientSocket.emit('unsubscribe:analytics', guildId);

                setTimeout(() => {
                    // This event should not be received
                    let eventReceived = false;

                    clientSocket.on('analytics:update', () => {
                        eventReceived = true;
                    });

                    websocketService.emitAnalyticsUpdate(guildId, {
                        test: 'data',
                    });

                    setTimeout(() => {
                        expect(eventReceived).toBe(false);
                        done();
                    }, 100);
                }, 100);
            }, 100);
        });
    });

    describe('Event emissions', () => {
        it('should emit new message events', (done) => {
            const guildId = '123456789';
            const token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                clientSocket.emit('subscribe:guild', guildId);

                setTimeout(() => {
                    websocketService.emitNewMessage(guildId, {
                        userId: 'user-1',
                        username: 'TestUser',
                        channelId: 'channel-1',
                        channelName: 'general',
                        timestamp: new Date(),
                    });
                }, 100);
            });

            clientSocket.on(
                'message:new',

                (data: any) => {
                    expect(data.username).toBe('TestUser');
                    expect(data.channelName).toBe('general');
                    done();
                }
            );
        });

        it('should emit multi-client alerts', (done) => {
            const guildId = '123456789';
            const token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                clientSocket.emit('subscribe:guild', guildId);

                setTimeout(() => {
                    websocketService.emitMultiClientAlert(guildId, {
                        userId: 'user-1',
                        username: 'TestUser',
                        platforms: ['desktop', 'mobile'],
                        timestamp: new Date(),
                    });
                }, 100);
            });

            clientSocket.on(
                'alert:multiClient',

                (data: any) => {
                    expect(data.username).toBe('TestUser');
                    expect(data.platforms).toEqual(['desktop', 'mobile']);
                    done();
                }
            );
        });

        it('should emit role change events', (done) => {
            const guildId = '123456789';
            const token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                clientSocket.emit('subscribe:guild', guildId);

                setTimeout(() => {
                    websocketService.emitRoleChange(guildId, {
                        userId: 'user-1',
                        username: 'TestUser',
                        addedRoles: ['Moderator'],
                        timestamp: new Date(),
                    });
                }, 100);
            });

            clientSocket.on(
                'role:change',

                (data: any) => {
                    expect(data.username).toBe('TestUser');
                    expect(data.addedRoles).toEqual(['Moderator']);
                    done();
                }
            );
        });

        it('should emit user join events', (done) => {
            const guildId = '123456789';
            const token = generateAccessToken({
                userId: 'test-user',
                discordId: '123456789',
                username: 'TestUser',
                role: 'USER',
                access: true,
            });

            clientSocket = ioClient(`http://127.0.0.1:${serverPort}`, {
                auth: { token },
                transports: ['websocket'],
            });

            clientSocket.on('connect', () => {
                clientSocket.emit('subscribe:guild', guildId);

                setTimeout(() => {
                    websocketService.emitUserJoin(guildId, {
                        userId: 'user-1',
                        username: 'NewUser',
                        accountAgeDays: 30,
                        timestamp: new Date(),
                    });
                }, 100);
            });

            clientSocket.on(
                'user:join',

                (data: any) => {
                    expect(data.username).toBe('NewUser');
                    expect(data.accountAgeDays).toBe(30);
                    done();
                }
            );
        });
    });
});
