import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert } from '../../../components/ui/Alert';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';

describe('status primitives', () => {
    it('announces danger assertively and other tones politely', () => {
        render(
            <>
                <Alert tone="danger">Not saved.</Alert>
                <Alert tone="success">Saved.</Alert>
            </>
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Not saved.');
        expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    });
    it('lets a caller opt out of a live region', () => {
        render(
            <Alert tone="success" role="none" title="All clear">
                No incidents.
            </Alert>
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByText('All clear')).toBeInTheDocument();
    });
    it('renders badge tones and empty states with their text', () => {
        render(
            <>
                <Badge tone="warning">Needs operator</Badge>
                <EmptyState
                    title="No cases yet"
                    actions={<a href="/m">Queue one</a>}
                >
                    <p>Queued actions appear here.</p>
                </EmptyState>
            </>
        );
        expect(screen.getByText('Needs operator')).toHaveClass(
            'bl-badge-warning'
        );
        expect(
            screen.getByRole('heading', { name: 'No cases yet' })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Queue one' })
        ).toBeInTheDocument();
    });
});
