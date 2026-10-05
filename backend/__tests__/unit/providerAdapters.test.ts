import axios from 'axios';

import {
    parseFeed,
    publicAddress,
    pollProvider,
} from '../../src/integrations/adapters';
import { providerSource } from '../../src/integrations/config';
import { env } from '../../src/utils/env';

jest.mock('axios');
describe('provider adapters', () => {
    afterEach(() => jest.restoreAllMocks());
    it('rejects private, loopback and mapped addresses while accepting public addresses', () => {
        for (const address of [
            '127.0.0.1',
            '10.1.2.3',
            '169.254.169.254',
            '192.168.1.1',
            '100.64.0.1',
            '::1',
            '::ffff:8.8.8.8',
            'fc00::1',
            '2001:db8::1',
        ])
            expect(publicAddress(address)).toBe(false);
        expect(publicAddress('8.8.8.8')).toBe(true);
        expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    });
    it('rejects non-HTTPS or credential-bearing feeds', () => {
        for (const source of [
            'http://example.org/feed',
            'https://user:secret@example.org/feed',
            'https://example.org:8443/feed',
        ])
            expect(
                providerSource.safeParse({ provider: 'rss', source }).success
            ).toBe(false);
    });
    it('parses bounded RSS with a stable hashed identity', () => {
        const text =
            '<rss><channel><item><guid>abc</guid><title>Hello</title><link>https://example.org/post</link><pubDate>2026-10-04T10:00:00Z</pubDate></item></channel></rss>';
        const first = parseFeed(text);
        expect(first).toHaveLength(1);
        expect(first[0].id).toHaveLength(64);
        expect(parseFeed(text)[0].id).toBe(first[0].id);
    });
    it('parses Atom alternate links and rejects entity declarations', () => {
        const text =
            '<feed><entry><id>urn:post:one</id><title>Post</title><updated>2026-10-04T10:00:00Z</updated><link href="https://example.org/post" rel="alternate"/></entry></feed>';
        expect(parseFeed(text)[0].url).toBe('https://example.org/post');
        expect(() =>
            parseFeed('<!DOCTYPE rss [<!ENTITY x "oops">]><rss/>')
        ).toThrow();
        expect(() => parseFeed('x'.repeat(512001))).toThrow();
    });
    it('uses the channel uploads playlist for YouTube and constructs a fixed watch URL', async () => {
        const prior = env.YOUTUBE_API_KEY;
        env.YOUTUBE_API_KEY = 'test-api-key';
        jest.mocked(axios.get)
            .mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            contentDetails: {
                                relatedPlaylists: { uploads: 'UUtest' },
                            },
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            snippet: { title: 'Upload' },
                            contentDetails: {
                                videoId: 'abcdefghijk',
                                videoPublishedAt: '2026-10-04T10:00:00Z',
                            },
                        },
                    ],
                },
            });
        try {
            const items = await pollProvider({
                provider: 'youtube',
                source: 'UC' + 'a'.repeat(22),
            });
            expect(items[0].url).toBe(
                'https://www.youtube.com/watch?v=abcdefghijk'
            );
            expect(
                jest.mocked(axios.get).mock.calls[1][1]?.params.playlistId
            ).toBe('UUtest');
        } finally {
            env.YOUTUBE_API_KEY = prior;
        }
    });
    it('redacts provider errors', async () => {
        jest.mocked(axios.get).mockRejectedValue(new Error('secret-key'));
        const prior = env.YOUTUBE_API_KEY;
        env.YOUTUBE_API_KEY = 'test-api-key';
        try {
            await expect(
                pollProvider({
                    provider: 'youtube',
                    source: 'UC' + 'a'.repeat(22),
                })
            ).rejects.toThrow('Provider unavailable; retry with backoff');
        } finally {
            env.YOUTUBE_API_KEY = prior;
        }
    });
});
