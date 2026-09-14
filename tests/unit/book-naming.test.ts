import { describe, expect, it } from 'vitest';
import {
    findFreeName,
    nameEquals,
    stripTrailingIndex,
} from '../../src/core/sync/bookNaming';

describe('bookNaming (FR-023; mirrors app getFreeWorldName, WI:4311)', () => {
    it('strips a trailing " (N)" index before searching', () => {
        expect(stripTrailingIndex('Aldermeer')).toBe('Aldermeer');
        expect(stripTrailingIndex('Aldermeer (2)')).toBe('Aldermeer');
        expect(stripTrailingIndex('Aldermeer (12)')).toBe('Aldermeer');
        expect(stripTrailingIndex('Name (not an index)')).toBe('Name (not an index)');
    });

    it('keeps the base name when it is free', () => {
        expect(findFreeName(['Other'], 'Aldermeer')).toBe('Aldermeer');
    });

    it('resolves the first free "Base (N)" when the base is taken', () => {
        expect(findFreeName(['Aldermeer'], 'Aldermeer')).toBe('Aldermeer (1)');
        expect(findFreeName(['Aldermeer', 'Aldermeer (1)'], 'Aldermeer')).toBe('Aldermeer (2)');
        expect(findFreeName(['Aldermeer', 'Aldermeer (1)', 'Aldermeer (2)'], 'Aldermeer (3)')).toBe(
            'Aldermeer (3)'
        );
    });

    it('compares names case- and accent-insensitively (checkOverwriteExistingData parity)', () => {
        expect(nameEquals('Aldermeer', 'aldermeer')).toBe(true);
        expect(nameEquals('Cafe', 'Café')).toBe(true);
        expect(nameEquals('Cafe', 'Cafee')).toBe(false);
        expect(findFreeName(['ALDERMEER'], 'Aldermeer')).toBe('Aldermeer (1)');
    });
});