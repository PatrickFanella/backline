import sharp from 'sharp';

import {
    originalTemplates,
    templateProvenance,
} from '../../src/entertainment/catalog';
import { renderTemplate, templateSvg } from '../../src/entertainment/images';

describe('original image templates', () => {
    it('escapes captions and rejects arbitrary template IDs and overlong captions', () => {
        const svg = templateSvg('loading', '<script>&"\'');
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('<image');
        expect(() =>
            templateSvg('https://example.org/image', 'Caption')
        ).toThrow();
        expect(() => templateSvg('loading', 'x'.repeat(61))).toThrow();
        expect(templateProvenance.source).toContain('catalog.ts');
    });
    it.each(Object.keys(originalTemplates))(
        'renders %s as a bounded 512px PNG',
        async (id) => {
            const png = await renderTemplate(id, 'A SHOW WORTH WAITING FOR');
            const metadata = await sharp(png).metadata();
            expect(metadata).toMatchObject({
                format: 'png',
                width: 512,
                height: 512,
            });
            expect(png.length).toBeLessThan(1048576);
        }
    );
});
