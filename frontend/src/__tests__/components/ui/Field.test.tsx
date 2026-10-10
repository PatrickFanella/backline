import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
    Checkbox,
    Input,
    Select,
    Textarea,
} from '../../../components/ui/Field';

describe('form fields', () => {
    it('associates the label, hint and error with the control', () => {
        render(
            <Input
                label="Log channel ID"
                hint="Copy it from Discord."
                error="Must be 17 to 20 digits."
                defaultValue="x"
            />
        );
        const input = screen.getByLabelText('Log channel ID');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(
            'Copy it from Discord. Must be 17 to 20 digits.'
        );
        expect(input).toHaveClass('bl-input');
    });
    it('keeps compact controls narrow and plain controls full width', () => {
        render(
            <>
                <Input label="Minutes" compact type="number" />
                <Textarea label="Reason" />
            </>
        );
        expect(screen.getByLabelText('Minutes')).toHaveClass(
            'bl-input-compact'
        );
        expect(screen.getByLabelText('Reason')).toHaveClass('bl-input');
    });
    it('labels selects and checkboxes', () => {
        render(
            <>
                <Select label="Action" defaultValue="warn">
                    <option>warn</option>
                    <option>kick</option>
                </Select>
                <Checkbox label="Include content" hint="Needs an intent." />
            </>
        );
        expect(screen.getByLabelText('Action')).toHaveValue('warn');
        const box = screen.getByLabelText('Include content');
        expect(box).toHaveAttribute('type', 'checkbox');
        expect(box).toHaveAccessibleDescription('Needs an intent.');
    });
});
