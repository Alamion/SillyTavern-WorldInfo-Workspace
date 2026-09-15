import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createYamlCodec } from '../../src/adapters/yamlCodec';

/** The codec must use the app-bundled library (`SillyTavern.libs.yaml`, research R3). */
describe('yamlCodec adapter', () => {
    afterEach(() => {
        delete (globalThis as { SillyTavern?: unknown }).SillyTavern;
    });

    it('delegates to SillyTavern.libs.yaml without folding lines', () => {
        const parse = vi.fn((text: string) => YAML.parse(text) as unknown);
        const stringify = vi.fn((value: unknown, options?: { lineWidth?: number }) => YAML.stringify(value, options));
        (globalThis as { SillyTavern?: unknown }).SillyTavern = {
            getContext: () => ({}),
            libs: { yaml: { parse, stringify } },
        };
        const codec = createYamlCodec();
        const long = 'x '.repeat(200);
        expect(codec.parse(codec.stringify({ wi_keys: ['a'], text: long }))).toEqual({ wi_keys: ['a'], text: long });
        expect(stringify).toHaveBeenCalledWith(expect.anything(), { lineWidth: 0 });
        expect(parse).toHaveBeenCalled();
    });

    it('fails clearly when the app library is missing', () => {
        (globalThis as { SillyTavern?: unknown }).SillyTavern = { getContext: () => ({}) };
        expect(() => createYamlCodec()).toThrow(/SillyTavern\.libs\.yaml/);
    });
});
