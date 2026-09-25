import { describe, expect, it } from 'vitest';
import { FIELD_SCHEMA, selectiveFor } from '../../src/core/fieldSchema';

describe('selective follows the optional filter', () => {
    it('is on only when the optional filter has keywords', () => {
        expect(selectiveFor([])).toBe(false);
        expect(selectiveFor(['night'])).toBe(true);
    });

    it('is not an editable field', () => {
        expect(FIELD_SCHEMA.some((meta) => meta.name === 'selective')).toBe(false);
    });
});
