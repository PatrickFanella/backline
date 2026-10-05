// Deliberately accepts only the canonical PCM subset of RIFF/WAVE, not arbitrary media.
export function validateWave(data: Buffer) {
    if (
        data.length < 44 ||
        data.length > 3 * 1024 * 1024 ||
        data.toString('ascii', 0, 4) !== 'RIFF' ||
        data.readUInt32LE(4) !== data.length - 8 ||
        data.toString('ascii', 8, 12) !== 'WAVE' ||
        data.toString('ascii', 12, 16) !== 'fmt ' ||
        data.readUInt32LE(16) !== 16 ||
        data.readUInt16LE(20) !== 1 ||
        data.toString('ascii', 36, 40) !== 'data'
    )
        throw new Error('Canonical PCM WAV required');
    const channels = data.readUInt16LE(22),
        rate = data.readUInt32LE(24),
        bytesPerSecond = data.readUInt32LE(28),
        align = data.readUInt16LE(32),
        bits = data.readUInt16LE(34),
        length = data.readUInt32LE(40);
    if (
        ![1, 2].includes(channels) ||
        ![44100, 48000].includes(rate) ||
        bits !== 16 ||
        align !== channels * 2 ||
        bytesPerSecond !== rate * align ||
        length !== data.length - 44 ||
        length % align !== 0
    )
        throw new Error('Unsupported or malformed PCM WAV');
    const durationMs = Math.ceil((length / bytesPerSecond) * 1000);
    if (durationMs < 50 || durationMs > 15000)
        throw new Error('Clip duration must be 0.05 to 15 seconds');
    return { durationMs, byteSize: data.length, channels, rate };
}
