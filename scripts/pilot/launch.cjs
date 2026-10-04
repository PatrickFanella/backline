// Run from a pinned backend build. Environment files remain outside the bundle.
const path = require('node:path');
const backend = path.resolve(__dirname, '../../backend');
const entry = { bot: 'index.js', api: 'server.js', migrate: null };
const mode = process.argv[2];
if (!Object.hasOwn(entry, mode)) throw new Error('Expected bot, api or migrate');
const dotenv = require(path.join(backend, 'node_modules/dotenv'));
for (const envPath of process.argv.slice(3)) {
    const result = dotenv.config({ path: envPath, override: true, quiet: true });
    if (result.error) throw new Error('Pilot environment file unavailable');
}
process.chdir(backend);
if (mode === 'migrate') {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, [
        path.join(backend, 'node_modules/prisma/build/index.js'),
        'migrate', 'deploy',
    ], { env: process.env, stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
require(path.join(backend, 'node_modules/ts-node')).register({
    project: path.join(backend, 'tsconfig.json'),
});
require(path.join(backend, 'dist/src', entry[mode]));
