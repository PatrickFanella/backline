import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

import axios from 'axios';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';

import { env } from '../utils/env';

import { providerSource } from './config';

export type ProviderItem = {
    id: string;
    title: string;
    url: string;
    publishedAt: Date;
};
export type ProviderSource = z.infer<typeof providerSource>;
export function publicAddress(address: string) {
    if (!ipaddr.isValid(address)) return false;
    const parsed = ipaddr.parse(address);
    return (
        parsed.range() === 'unicast' &&
        (parsed.kind() === 'ipv4' ||
            (parsed as ipaddr.IPv6).match(
                ipaddr.parse('2000::') as ipaddr.IPv6,
                3
            ))
    );
}
export async function publicFeedText(source: string): Promise<string> {
    const url = new URL(
        providerSource.parse({ provider: 'rss', source }).source
    );
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
        lookup(url.hostname, { all: true }),
        new Promise<never>((_resolve, reject) => {
            dnsTimer = setTimeout(
                () => reject(new Error('Feed DNS timed out')),
                5000
            );
        }),
    ]).finally(() => {
        if (dnsTimer) clearTimeout(dnsTimer);
    });
    if (
        !addresses.length ||
        addresses.some((row) => !publicAddress(row.address))
    )
        throw new Error('Feed must resolve to public addresses');
    const address = addresses[0];
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                agent: false,
                headers: {
                    'User-Agent': 'Backline/1.0',
                    Accept: 'application/rss+xml, application/atom+xml, application/xml',
                },
                lookup: (_hostname, _options, callback) =>
                    callback(null, address.address, address.family),
            },
            (response) => {
                if (response.statusCode !== 200) {
                    response.resume();
                    reject(
                        new Error('Feed unavailable or redirects unsupported')
                    );
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 512000) {
                        req.destroy(new Error('Feed exceeds size limit'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () =>
                    resolve(Buffer.concat(chunks).toString('utf8'))
                );
                response.on('error', reject);
            }
        );
        const timer = setTimeout(
            () => req.destroy(new Error('Feed timed out')),
            10000
        );
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end();
    });
}
const atomEntry = z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    published: z.string().optional(),
    updated: z.string().optional(),
    link: z.union([
        z.array(
            z.object({ '@_href': z.string(), '@_rel': z.string().optional() })
        ),
        z.object({ '@_href': z.string(), '@_rel': z.string().optional() }),
    ]),
});
const rssEntry = z.object({
    guid: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
    title: z.string().optional(),
    link: z.string(),
    pubDate: z.string(),
});
function safeItem(
    id: string,
    title: string,
    url: string,
    date: string
): ProviderItem | undefined {
    try {
        const link = new URL(url),
            publishedAt = new Date(date);
        if (
            link.protocol !== 'https:' ||
            link.username ||
            link.password ||
            url.length > 1000 ||
            !Number.isFinite(publishedAt.getTime())
        )
            return;
        return {
            id: createHash('sha256').update(id).digest('hex'),
            title: title.replace(/<[^>]*>/g, '').slice(0, 200),
            url: link.href,
            publishedAt,
        };
    } catch {
        return;
    }
}
export function parseFeed(text: string): ProviderItem[] {
    if (
        Buffer.byteLength(text) > 512000 ||
        /<!DOCTYPE|<!ENTITY/i.test(text) ||
        XMLValidator.validate(text) !== true
    )
        throw new Error('Unsupported feed XML');
    let depth = 0;
    for (const match of text.matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
        const tag = match[0];
        if (tag.startsWith('</')) depth--;
        else if (!tag.endsWith('/>')) depth++;
        if (depth > 32) throw new Error('Feed XML nesting exceeds limit');
    }
    const raw = new XMLParser({
        ignoreAttributes: false,
        parseTagValue: false,
        processEntities: false,
        isArray: (_name, path) =>
            path === 'rss.channel.item' || path === 'feed.entry',
    }).parse(text) as {
        rss?: { channel?: { item?: unknown[] } };
        feed?: { entry?: unknown[] };
    };
    const items: ProviderItem[] = [];
    for (const value of (raw.rss?.channel?.item ?? raw.feed?.entry ?? []).slice(
        0,
        100
    )) {
        if (raw.rss) {
            const result = rssEntry.safeParse(value);
            if (!result.success) continue;
            const row = result.data,
                id =
                    typeof row.guid === 'string'
                        ? row.guid
                        : row.guid?.['#text'];
            const item = safeItem(
                id ?? row.link,
                row.title ?? 'New post',
                row.link,
                row.pubDate
            );
            if (item) items.push(item);
        } else {
            const result = atomEntry.safeParse(value);
            if (!result.success) continue;
            const row = result.data,
                links = Array.isArray(row.link) ? row.link : [row.link],
                link = links.find(
                    (l) => !l['@_rel'] || l['@_rel'] === 'alternate'
                )?.['@_href'];
            if (!link) continue;
            const item = safeItem(
                row.id ?? link,
                row.title ?? 'New post',
                link,
                row.published ?? row.updated ?? ''
            );
            if (item) items.push(item);
        }
    }
    return items;
}
let twitchToken:
    | { value: string; expires: number; validated: number }
    | undefined;
const options = { timeout: 10000, maxRedirects: 0, maxContentLength: 512000 };
async function token() {
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET)
        throw new Error('Twitch operator credentials unavailable');
    if (twitchToken && twitchToken.expires > Date.now() + 60000) {
        if (twitchToken.validated < Date.now() - 3600000) {
            await axios.get('https://id.twitch.tv/oauth2/validate', {
                ...options,
                headers: { Authorization: 'OAuth ' + twitchToken.value },
            });
            twitchToken.validated = Date.now();
        }
        return twitchToken.value;
    }
    const response = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }).toString(),
        {
            ...options,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
    );
    const parsed = z
        .object({ access_token: z.string(), expires_in: z.number().positive() })
        .parse(response.data);
    await axios.get('https://id.twitch.tv/oauth2/validate', {
        ...options,
        headers: { Authorization: 'OAuth ' + parsed.access_token },
    });
    twitchToken = {
        value: parsed.access_token,
        expires: Date.now() + parsed.expires_in * 1000,
        validated: Date.now(),
    };
    return parsed.access_token;
}
export async function pollProvider(
    input: ProviderSource
): Promise<ProviderItem[]> {
    const source = providerSource.parse(input);
    try {
        if (source.provider === 'rss')
            return parseFeed(await publicFeedText(source.source));
        if (source.provider === 'twitch') {
            const response = await axios.get(
                'https://api.twitch.tv/helix/streams',
                {
                    ...options,
                    params: { user_login: source.source, first: 1 },
                    headers: {
                        'Client-Id': env.TWITCH_CLIENT_ID,
                        Authorization: 'Bearer ' + (await token()),
                    },
                }
            );
            const parsed = z
                .object({
                    data: z
                        .array(
                            z.object({
                                id: z.string(),
                                title: z.string(),
                                started_at: z.string(),
                            })
                        )
                        .max(1),
                })
                .parse(response.data);
            return parsed.data.flatMap((row) => {
                const item = safeItem(
                    row.id,
                    row.title,
                    'https://www.twitch.tv/' + source.source,
                    row.started_at
                );
                return item ? [item] : [];
            });
        }
        if (!env.YOUTUBE_API_KEY)
            throw new Error('YouTube operator credential unavailable');
        const channels = await axios.get(
            'https://www.googleapis.com/youtube/v3/channels',
            {
                ...options,
                params: {
                    id: source.source,
                    part: 'contentDetails',
                    key: env.YOUTUBE_API_KEY,
                },
            }
        );
        const channel = z
            .object({
                items: z
                    .array(
                        z.object({
                            contentDetails: z.object({
                                relatedPlaylists: z.object({
                                    uploads: z.string(),
                                }),
                            }),
                        })
                    )
                    .length(1),
            })
            .parse(channels.data);
        const response = await axios.get(
            'https://www.googleapis.com/youtube/v3/playlistItems',
            {
                ...options,
                params: {
                    playlistId:
                        channel.items[0].contentDetails.relatedPlaylists
                            .uploads,
                    part: 'contentDetails,snippet',
                    maxResults: 50,
                    key: env.YOUTUBE_API_KEY,
                },
            }
        );
        const parsed = z
            .object({
                items: z
                    .array(
                        z.object({
                            snippet: z.object({ title: z.string() }),
                            contentDetails: z.object({
                                videoId: z
                                    .string()
                                    .regex(/^[a-zA-Z0-9_-]{11}$/),
                                videoPublishedAt: z.string(),
                            }),
                        })
                    )
                    .max(50),
            })
            .parse(response.data);
        return parsed.items.flatMap((row) => {
            const item = safeItem(
                row.contentDetails.videoId,
                row.snippet.title,
                'https://www.youtube.com/watch?v=' + row.contentDetails.videoId,
                row.contentDetails.videoPublishedAt
            );
            return item ? [item] : [];
        });
    } catch {
        twitchToken = source.provider === 'twitch' ? undefined : twitchToken;
        throw new Error('Provider unavailable; retry with backoff');
    }
}
