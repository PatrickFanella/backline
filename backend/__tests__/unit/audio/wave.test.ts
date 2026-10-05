import { validateWave } from '../../../src/audio/wave';
import { pcmWave } from '../../fixtures/pcmWave';

describe('bounded canonical PCM uploads', () => {
    it.each([
        [1, 44100],
        [2, 48000],
    ])('accepts %s channels at %s Hz', (channels, rate) =>
        expect(validateWave(pcmWave(15, 0, channels, rate))).toMatchObject({
            durationMs: 15000,
            channels,
            rate,
        })
    );
    it.each([4, 16, 20, 22, 24, 28, 32, 34, 40])(
        'rejects a corrupt header at %s',
        (offset) => {
            const file = pcmWave();
            file.writeUInt16LE(65535, offset);
            expect(() => validateWave(file)).toThrow();
        }
    );
    it('rejects mismatched RIFF length, truncated frames, extra chunks and unbounded duration', () => {
        for (const data of [
            Buffer.alloc(20),
            pcmWave(0.01),
            pcmWave(16),
            Buffer.concat([pcmWave(), Buffer.from('extra')]),
            pcmWave().subarray(0, 100),
            Buffer.alloc(3 * 1024 * 1024 + 1),
        ])
            expect(() => validateWave(data)).toThrow();
    });
});
