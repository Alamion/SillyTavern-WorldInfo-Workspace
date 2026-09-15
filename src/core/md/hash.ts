import type { Digest } from './ports';

/** Hashing and text decoding helpers (research R7, R11). */

export class DecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DecodeError';
    }
}

export function textBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/** Strict UTF-8 with BOM removal; invalid byte sequences throw DecodeError. */
export function decodeText(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
        throw new DecodeError('The file is not valid UTF-8 text.');
    }
}

export function hashText(text: string, digest: Digest): Promise<string> {
    return digest(textBytes(text));
}

/** Web Crypto SHA-256 (secure contexts; also available in Node test runs). */
export const webDigest: Digest = async (bytes) => {
    const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
