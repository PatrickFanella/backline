import { Request } from 'express';

const healthProbePaths = new Set([
    '/health',
    '/api/health',
    '/health/live',
    '/health/ready',
]);

export function isHealthProbe(req: Request): boolean {
    return (
        (req.method === 'GET' || req.method === 'HEAD') &&
        healthProbePaths.has(req.path)
    );
}
