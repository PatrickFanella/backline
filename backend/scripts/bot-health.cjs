const { readFileSync } = require('node:fs');
try {
    const status = JSON.parse(
        readFileSync('/tmp/backline-bot-ready.json', 'utf8')
    );
    if (status.ready !== true || Date.now() - status.updatedAt > 60000)
        process.exit(1);
} catch {
    process.exit(1);
}
