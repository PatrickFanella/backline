export function pcmWave(seconds = 0.1, marker = 0, channels = 1, rate = 48000) {
    const length = Math.round(seconds * rate) * channels * 2,
        data = Buffer.alloc(44 + length, marker);
    data.write('RIFF', 0);
    data.writeUInt32LE(data.length - 8, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(channels, 22);
    data.writeUInt32LE(rate, 24);
    data.writeUInt32LE(rate * channels * 2, 28);
    data.writeUInt16LE(channels * 2, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(length, 40);
    return data;
}
