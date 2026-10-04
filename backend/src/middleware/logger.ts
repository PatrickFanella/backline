import { Request } from 'express';
import morgan from 'morgan';

import logger from './winstonLogger';

morgan.token('safe-url', (req: Request) => req.originalUrl.split('?')[0]);

morgan.token('user-id', (req: Request) => {
    const user = (req as Request & { user?: { discordId?: string } }).user;
    return user?.discordId || 'anonymous';
});

export const requestLogger = morgan(
    ':user-id :method :safe-url :status - :response-time ms ":user-agent"',
    {
        stream: {
            write: (message: string) => logger.http(message.trim()),
        },
    }
);
