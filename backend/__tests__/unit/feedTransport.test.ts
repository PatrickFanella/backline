import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { request } from 'node:https';

import { publicFeedText } from '../../src/integrations/adapters';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
describe('RSS transport', () => {
    beforeEach(() => jest.clearAllMocks());
    function transport(status: number, body = 'feed') {
        const req = new EventEmitter() as EventEmitter & {
            end: () => void;
            destroy: (error: Error) => void;
        };
        const response = new EventEmitter() as EventEmitter & {
            statusCode: number;
            resume: () => void;
        };
        response.statusCode = status;
        response.resume = jest.fn();
        req.destroy = (error) => req.emit('error', error);
        req.end = () => {
            const call = jest.mocked(request).mock.calls[0];
            const callback = call[2] as (response: unknown) => void;
            callback(response);
            response.emit('data', Buffer.from(body));
            response.emit('end');
            req.emit('close');
        };
        jest.mocked(request).mockReturnValue(req as never);
    }
    it('rejects DNS resolving to any private address before opening a socket', async () => {
        jest.mocked(lookup).mockResolvedValue([
            { address: '8.8.8.8', family: 4 },
            { address: '127.0.0.1', family: 4 },
        ] as never);
        await expect(
            publicFeedText('https://example.org/feed')
        ).rejects.toThrow('public addresses');
        expect(request).not.toHaveBeenCalled();
    });
    it('pins the validated DNS address for the HTTPS connection', async () => {
        jest.mocked(lookup).mockResolvedValue([
            { address: '8.8.8.8', family: 4 },
        ] as never);
        transport(200);
        expect(await publicFeedText('https://example.org/feed')).toBe('feed');
        const options = jest.mocked(request).mock.calls[0][1] as {
            lookup: (
                hostname: string,
                options: unknown,
                callback: (
                    error: unknown,
                    address: string,
                    family: number
                ) => void
            ) => void;
            agent: boolean;
        };
        const callback = jest.fn();
        options.lookup('example.org', {}, callback);
        expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
        expect(options.agent).toBe(false);
        expect(lookup).toHaveBeenCalledTimes(1);
    });
    it('rejects redirects instead of following an unchecked destination', async () => {
        jest.mocked(lookup).mockResolvedValue([
            { address: '8.8.8.8', family: 4 },
        ] as never);
        transport(302);
        await expect(
            publicFeedText('https://example.org/feed')
        ).rejects.toThrow('redirects unsupported');
        expect(request).toHaveBeenCalledTimes(1);
    });
});
