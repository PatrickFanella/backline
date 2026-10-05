import { writeFileSync, unlinkSync } from 'node:fs';

import { startBot } from './bot/startup';
import { closeDatabaseConnections } from './db';
import { pluginManager } from './plugins';

void startBot()
    .then((client) => {
        const heartbeat = setInterval(() => {
            writeFileSync(
                '/tmp/backline-bot-ready.json',
                JSON.stringify({
                    ready: client.isReady(),
                    updatedAt: Date.now(),
                }),
                { mode: 0o600 }
            );
        }, 15000);
        heartbeat.unref();
        let stopping = false;
        const stop = () => {
            if (stopping) return;
            stopping = true;
            clearInterval(heartbeat);
            try {
                unlinkSync('/tmp/backline-bot-ready.json');
            } catch {
                /* No heartbeat yet. */
            }
            void (async () => {
                await client.destroy();
                await pluginManager.shutdown();
                await closeDatabaseConnections();
                process.exit(0);
            })().catch(() => {
                process.exit(1);
            });
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    })
    .catch(async () => {
        console.error('Bot startup failed');
        await closeDatabaseConnections();
        process.exitCode = 1;
    });
