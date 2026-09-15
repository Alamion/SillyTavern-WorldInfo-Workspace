/** data: URI helpers shared by export (decode) and import (encode fallback). */

export function decodeDataUri(src: string): { bytes: Uint8Array; mime: string } | null {
    const match = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(src);
    if (!match) {
        return null;
    }
    const mime = (match[1] ?? '').toLowerCase() || 'text/plain';
    const isBase64 = (match[2] ?? '').split(';').includes('base64');
    const payload = match[3] ?? '';
    try {
        if (isBase64) {
            return { bytes: base64ToBytes(payload), mime };
        }
        return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime };
    } catch {
        return null;
    }
}

export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Chunked to stay below argument-count limits of String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
