import { randomUUID } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

export function attachRequestId(
    req: Request,
    res: Response,
    next: NextFunction
) {
    req.id = randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
}
