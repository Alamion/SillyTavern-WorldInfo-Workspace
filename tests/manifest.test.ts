import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));
const manifest: Record<string, unknown> = JSON.parse(readFileSync(manifestPath, 'utf8'));

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

function field(key: string): unknown {
    const value = manifest[key];
    if (value === undefined) {
        throw new Error(`missing manifest field: ${key}`);
    }
    return value;
}

describe('extension manifest', () => {
    it('points to the bundled extension script', () => {
        expect(field('js')).toBe('dist/index.js');
    });

    it('has a non-empty display name', () => {
        expect(typeof field('display_name')).toBe('string');
        expect(field('display_name')).not.toBe('');
    });

    it('uses semantic versioning', () => {
        const version = field('version');
        expect(typeof version).toBe('string');
        expect(SEMVER_PATTERN.test(String(version))).toBe(true);
    });

    it('declares a non-empty author', () => {
        expect(typeof field('author')).toBe('string');
        expect(field('author')).not.toBe('');
    });

    it('declares dependency arrays and auto-update flag', () => {
        expect(Array.isArray(field('requires'))).toBe(true);
        expect(Array.isArray(field('optional'))).toBe(true);
        expect(typeof field('auto_update')).toBe('boolean');
    });

    it('declares the stylesheet field as a string', () => {
        expect(typeof field('css')).toBe('string');
    });
});
