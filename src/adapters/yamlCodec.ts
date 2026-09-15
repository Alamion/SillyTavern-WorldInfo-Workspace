import type { YamlCodec } from '../core/md/ports';

/**
 * YAML through the app-bundled `yaml@2` library (`SillyTavern.libs.yaml`,
 * public/lib.js) — constitution II, spec 004 research R3. Never bundled here.
 */
export function createYamlCodec(): YamlCodec {
    const yaml = globalThis.SillyTavern?.libs?.yaml;
    if (!yaml) {
        throw new Error('[WorldInfoWorkspace] the app YAML library (SillyTavern.libs.yaml) is not available');
    }
    return {
        parse: (text) => yaml.parse(text),
        // lineWidth 0: never fold long strings, keeping files diff-friendly.
        stringify: (value) => yaml.stringify(value, { lineWidth: 0 }),
    };
}
