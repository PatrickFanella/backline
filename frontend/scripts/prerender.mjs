import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { render } from '../dist-ssr/entry-prerender.js';

const path = new URL('../dist/index.html', import.meta.url);
const html = await readFile(path, 'utf8');
const body = render();
if (!body.includes('<h1') || !body.includes('<main')) throw new Error('Landing content did not render');
if (!html.includes('<div id="root"></div>')) throw new Error('Missing root placeholder');
await writeFile(path, html.replace('<div id="root"></div>', `<div id="root">${body}</div>`));
// Private routes retain a separate empty shell and noindex metadata.
await writeFile(new URL('../dist/app.html', import.meta.url), html.replace('</head>', '<meta name="robots" content="noindex,nofollow">\n</head>').replace(/\s*<link rel="canonical"[^>]*>/, ''));
