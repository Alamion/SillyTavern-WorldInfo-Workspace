import { describe, expect, it } from 'vitest';
import { scanFolder } from '../../src/core/md/scan';
import { MemoryDiskFolder, nodeDigest as digest, nodeYaml as yaml } from '../support/memoryDisk';

function sampleVault(): MemoryDiskFolder {
    const folder = new MemoryDiskFolder();
    folder.writeText('Notes.md', '# Notes\nPlain');
    folder.writeText('Kingdoms/Aldermeer.md', '---\nwi_keys: [river]\ntags: [city]\n---\n\nBody');
    folder.writeText('Kingdoms/.wiw-folder.yaml', 'wi_root: true\nwi_book: Kingdoms East\n');
    folder.writeText('Kingdoms/Broken.md', '---\nwi_keys: [unclosed\n---\nx');
    folder.writeText('.obsidian/app.json', '{}');
    folder.writeText('Kingdoms/.hidden.md', 'secret');
    folder.writeText('Kingdoms/Aldermeer.md.crswap', 'swap');
    folder.writeText('report.pdf', 'PDF');
    folder.writeText('BOM.md', '﻿with bom\r\nline2');
    void folder.writeBytes('Kingdoms/map.png', new Uint8Array([137, 80, 78, 71]));
    void folder.writeBytes('Bad.md', new Uint8Array([0xff, 0xfe, 0xfd]));
    void folder.createDirectory('Empty');
    return folder;
}

describe('scanFolder (FR-008)', () => {
    it('parses entries, records and images and applies the ignore rules', async () => {
        const folder = sampleVault();
        await Promise.resolve();
        folder.resetLog();
        const before = folder.snapshot();
        const progress: number[] = [];
        const scan = await scanFolder(folder, { digest, yaml, onProgress: (done) => progress.push(done) });
        expect(scan.entries.map((entry) => entry.path).sort()).toEqual(['BOM.md', 'Kingdoms/Aldermeer.md', 'Kingdoms/Broken.md', 'Notes.md']);
        expect(scan.images.map((image) => image.path)).toEqual(['Kingdoms/map.png']);
        expect([...scan.folders.keys()].sort()).toEqual(['', 'Empty', 'Kingdoms']);
        expect(scan.folders.get('Kingdoms')?.record?.root).toBe(true);
        expect(scan.folders.get('Kingdoms')?.diskHash).not.toBe('');
        expect(scan.folders.get('Empty')?.record).toBeNull();
        const alder = scan.entries.find((entry) => entry.path === 'Kingdoms/Aldermeer.md');
        expect(alder?.model.native.key).toEqual(['river']);
        expect(alder?.model.md?.foreign).toEqual({ tags: ['city'] });
        expect(scan.entries.find((entry) => entry.path === 'BOM.md')?.model.native.content).toBe('with bom\r\nline2');
        expect(scan.lines).toEqual(
            expect.arrayContaining([
                { path: 'report.pdf', outcome: 'skipped', message: 'Not a markdown or image file.' },
                expect.objectContaining({ path: 'Bad.md', outcome: 'skipped' }),
                expect.objectContaining({ path: 'Kingdoms/Broken.md', outcome: 'warning' }),
            ])
        );
        expect(scan.lines.some((line) => line.path.includes('.obsidian') || line.path.includes('.hidden') || line.path.endsWith('.crswap'))).toBe(false);
        expect(progress.length).toBeGreaterThan(0);
        expect(folder.snapshot()).toEqual(before);
        expect(folder.writes).toEqual([]);
    });
});
