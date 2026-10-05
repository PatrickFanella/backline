const { spawnSync } = require('node:child_process');
for (const [command, args] of [
    ['node_modules/.bin/prisma', ['migrate', 'deploy']],
    [process.execPath, ['dist/prisma/seed.js']],
]) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        env: process.env,
    });
    if (result.status !== 0) process.exit(result.status || 1);
}
