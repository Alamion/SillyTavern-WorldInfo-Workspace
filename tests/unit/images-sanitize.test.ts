import { describe, expect, it } from 'vitest';
import { sanitizeGenerationPrompt } from '../../src/core/images/sanitize';

describe('sanitizeGenerationPrompt (spec 009 R1)', () => {
    it('turns a lone trigger word into a plain prompt', () => {
        expect(sanitizeGenerationPrompt('you')).toBe('you.');
        expect(sanitizeGenerationPrompt('  Background ')).toBe('Background.');
        expect(sanitizeGenerationPrompt('RAW_LAST')).toBe('RAW_LAST.');
    });

    it('leaves ordinary prompts alone except trimming', () => {
        expect(sanitizeGenerationPrompt(' a face in the fog ')).toBe('a face in the fog');
        expect(sanitizeGenerationPrompt('scene | /echo x {{user}}')).toBe('scene | /echo x {{user}}');
    });

    it('rejects an empty prompt', () => {
        expect(sanitizeGenerationPrompt('   ')).toBeNull();
    });
});
