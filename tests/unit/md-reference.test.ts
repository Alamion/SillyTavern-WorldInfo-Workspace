import { describe, expect, it } from 'vitest';
import { FIELD_SPECS, parseEntryFile } from '../../src/core/md/convention';
import { SAMPLE_ENTRY, entryReferenceRows, folderReferenceRows } from '../../src/core/md/reference';
import { nodeYaml as yaml } from '../support/memoryDisk';

describe('mapping reference (FR-018)', () => {
    it('lists every entry key of the convention with type and default', () => {
        const keys = entryReferenceRows().map((row) => row.key);
        for (const spec of FIELD_SPECS) {
            expect(keys).toContain(spec.key);
        }
        expect(keys).toEqual(expect.arrayContaining(['wi_title', 'wi_native', 'wi_id', '(body)']));
        for (const row of entryReferenceRows()) {
            expect(row.type).not.toBe('');
            expect(row.defaultValue).not.toBe('');
        }
        const position = entryReferenceRows().find((row) => row.key === 'wi_position');
        expect(position?.defaultValue).toBe('before_char');
        expect(entryReferenceRows().find((row) => row.key === 'wi_enabled')?.defaultValue).toBe('true');
    });

    it('lists the folder record keys', () => {
        expect(folderReferenceRows().map((row) => row.key)).toEqual(
            expect.arrayContaining(['wi_title', 'wi_root', 'wi_book', 'wi_order'])
        );
    });

    it('offers a sample entry that parses into the documented values', () => {
        const model = parseEntryFile(SAMPLE_ENTRY, 'Aldermeer', yaml);
        expect(model.native.key).toEqual(['Aldermeer', 'the river city']);
        expect(model.native.keysecondary).toEqual(['bridge']);
        expect(model.native.position).toBe(4);
        expect(model.native.depth).toBe(2);
        expect(model.native.order).toBe(120);
        expect(model.md?.foreign).toEqual({ tags: ['kingdom'] });
        expect(model.warnings).toEqual([]);
    });
});
