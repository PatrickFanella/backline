import { audioConfig, stationId } from '../../../src/audio/config';
import { approvedStream, playlistStreams } from '../../../src/audio/sources';

describe('published SomaFM sources', () => {
    it('uses DEF CON Radio by default', () =>
        expect(audioConfig.parse({}).defaultStation).toBe('defcon'));
    it.each([
        'https://127.0.0.1/audio',
        'https://ice2.somafm.com.evil.test/audio',
        'http://ice2.somafm.com/defcon-128-mp3',
        'https://user:password@ice2.somafm.com/defcon-128-mp3',
        'https://ice2.somafm.com:4430/audio',
        'https://ice2.somafm.com/audio?redirect=local',
        'file:///etc/passwd',
        'https://ice2.somafm.com/a/../private',
    ])('rejects an unapproved source %s', (source) =>
        expect(() => approvedStream(source)).toThrow()
    );
    it('extracts only the bounded published stream entries', () =>
        expect(
            playlistStreams(
                '[playlist]\nFile1=https://ice2.somafm.com/defcon-128-mp3\nTitle1=Station\nFile2=https://ice6.somafm.com/defcon-128-mp3'
            )
        ).toEqual([
            'https://ice2.somafm.com/defcon-128-mp3',
            'https://ice6.somafm.com/defcon-128-mp3',
        ]));
    it('rejects injected URLs and oversized playlists', () => {
        expect(() =>
            playlistStreams('File1=https://localhost/internal')
        ).toThrow();
        expect(() => playlistStreams('x'.repeat(65537))).toThrow();
    });
    it('accepts published station IDs and rejects prototype names or URLs', () => {
        expect(stationId.parse('defcon')).toBe('defcon');
        for (const value of [
            'constructor',
            '__proto__',
            'https://local/',
            'unknown-station',
        ])
            expect(() => stationId.parse(value)).toThrow();
    });
});
