import { Readable } from 'node:stream';

import { stationId } from './config';
import { somaStations } from './stations';

export function approvedStream(value: string): string {
    const url = new URL(value);
    if (
        url.protocol !== 'https:' ||
        !/^ice\d+\.somafm\.com$/.test(url.hostname) ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[a-z0-9-]{1,40}-\d{2,3}-mp3$/.test(url.pathname)
    )
        throw new Error('Unapproved stream URL');
    return url.toString();
}
export function playlistStreams(text: string): string[] {
    if (text.length > 65536) throw new Error('Playlist too large');
    const files = text
        .split(/\r?\n/)
        .filter((line) => /^File\d+=/.test(line))
        .slice(0, 10)
        .map((line) => line.slice(line.indexOf('=') + 1));
    return files.map(approvedStream);
}
async function boundedText(response: Response): Promise<string> {
    if (!response.body) throw new Error('Playlist unavailable');
    const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
    let length = 0;
    try {
        for (;;) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.length;
            if (length > 65536) throw new Error('Playlist too large');
            chunks.push(item.value);
        }
        return Buffer.concat(chunks).toString('utf8');
    } finally {
        await reader.cancel();
    }
}
export async function radioSource(
    station: string,
    controller: AbortController
): Promise<{ stream: Readable; url: string }> {
    stationId.parse(station);
    const entry = Object.entries(somaStations).find(
        ([key]) => key === station
    )?.[1];
    if (!entry) throw new Error('Unknown station');
    const playlist = entry.playlist;
    const url = new URL(playlist);
    if (
        url.protocol !== 'https:' ||
        !['api.somafm.com', 'somafm.com'].includes(url.hostname) ||
        !/^\/[a-z0-9-]+\.pls$/.test(url.pathname)
    )
        throw new Error('Unapproved station playlist');
    const response = await fetch(playlist, {
        redirect: 'error',
        signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
        ]),
    });
    if (!response.ok) throw new Error('Station playlist unavailable');
    const endpoints = playlistStreams(await boundedText(response));
    for (const endpoint of endpoints) {
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const streamResponse = await fetch(endpoint, {
                redirect: 'error',
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (
                !streamResponse.ok ||
                !streamResponse.body ||
                !/^(audio\/(mpeg|mp3)|application\/ogg)/i.test(
                    streamResponse.headers.get('content-type') ?? ''
                )
            ) {
                await streamResponse.body?.cancel();
                continue;
            }
            return {
                stream: Readable.fromWeb(streamResponse.body as never),
                url: endpoint,
            };
        } catch {
            if (controller.signal.aborted)
                throw new Error('Radio connection timed out');
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error('No approved station endpoint available');
}
