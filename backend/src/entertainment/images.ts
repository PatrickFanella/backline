import sharp from 'sharp';
import { z } from 'zod';

import { originalTemplates, templateId } from './catalog';

const caption = z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine(
        (value) =>
            !Array.from(value).some((char) => {
                const code = char.codePointAt(0)!;
                return code < 32 && ![9, 10, 13].includes(code);
            }),
        'Invalid caption'
    );
function escapeXml(value: string) {
    return value.replace(
        /[&<>"']/g,
        (value) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&apos;',
            })[value]!
    );
}
export function templateSvg(id: unknown, rawCaption: unknown) {
    const selected = templateId.parse(id),
        text = caption.parse(rawCaption).replace(/\s+/gu, ' '),
        theme = originalTemplates[selected];
    const lines =
        Array.from(text)
            .join('')
            .match(/.{1,18}/gu) ?? [];
    const body = lines
        .map(
            (line, index) =>
                `<text x="40" y="${130 + index * 40}" font-size="22">${escapeXml(line)}</text>`
        )
        .join('');
    const detail =
        selected === 'plot-twist'
            ? `<rect x="24" y="290" width="464" height="160" fill="${theme.accent}"/><text x="40" y="328" font-size="22">THE ACTUAL PLAN</text><text x="40" y="390" font-size="30">IMPROVISE TOGETHER.</text>`
            : selected === 'backstage-pass'
              ? `<path d="M24 300h464" stroke="${theme.accent}" stroke-width="3" stroke-dasharray="8 8"/><text x="40" y="350" font-size="20">ONE COMMUNITY / MANY VOICES</text><text x="40" y="420" font-size="42">ALL ACCESS</text>`
              : `<rect x="40" y="310" width="432" height="70" fill="none" stroke="${theme.accent}" stroke-width="4"/><rect x="50" y="320" width="230" height="50" fill="${theme.accent}"/><text x="40" y="430" font-size="22">GOOD THINGS TAKE A MINUTE.</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${theme.background}"/><g fill="${theme.foreground}" font-family="DejaVu Sans, sans-serif"><text x="40" y="62" font-size="18">BACKLINE / ${selected === 'plot-twist' ? 'THE PLAN' : selected === 'loading' ? 'STILL LOADING' : 'BACKSTAGE PASS'}</text>${body}${detail}<text x="40" y="488" font-size="13">Original Backline template</text></g></svg>`;
}
sharp.concurrency(2);
sharp.cache({ memory: 8, files: 0, items: 10 });
let active = 0;
export async function renderTemplate(
    id: unknown,
    text: unknown
): Promise<Buffer> {
    const svg = templateSvg(id, text);
    if (active >= 4) throw new Error('Image renderer busy');
    active++;
    try {
        const output = await sharp(Buffer.from(svg), {
            limitInputPixels: 512 * 512,
        })
            .timeout({ seconds: 5 })
            .png()
            .toBuffer();
        if (output.length > 1048576)
            throw new Error('Image renderer output limit');
        return output;
    } finally {
        active--;
    }
}
