import { startBot } from './bot/startup';
import { db } from './db';
import { pluginManager } from './plugins';

void startBot()
    .then((client) => {
        let stopping = false;
        const stop = () => {
            if (stopping) return;
            stopping = true;
            void (async () => {
                await client.destroy();
                await pluginManager.shutdown();
                await db.$disconnect();
            })().catch(() => {
                process.exitCode = 1;
            });
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    })
    .catch(async () => {
        console.error('Bot startup failed');
        await db.$disconnect();
        process.exitCode = 1;
    });
