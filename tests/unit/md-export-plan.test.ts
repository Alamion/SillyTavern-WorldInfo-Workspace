import { describe, expect, it } from 'vitest';
import { planExport } from '../../src/core/md/exportPlan';
import { parseFolderRecord } from '../../src/core/md/convention';
import { nodeYaml as yaml } from '../support/memoryDisk';
import { sampleState } from '../support/mdFixtures';

describe('planExport (US1)', () => {
    it('renders the whole workspace with minimal metadata and no ids', () => {
        const state = sampleState();
        const plan = planExport({ state, scopeFolderId: state.root.id, yaml })!;
        const byPath = new Map(plan.files.map((file) => [file.path, file]));
        expect([...byPath.keys()].sort()).toEqual([
            'Kingdoms/.wiw-folder.yaml',
            'Kingdoms/Aldermeer map.png',
            'Kingdoms/Aldermeer.md',
            'Kingdoms/Crest.svg',
            'Kingdoms/House Varn.md',
            'Kingdoms/Houses/.wiw-folder.yaml',
            'Kingdoms/Houses/A_B.md',
            'Kingdoms/Houses/a_b (2).md',
            'Notes.md',
        ].sort());
        expect(plan.directories).toEqual(['Kingdoms', 'Kingdoms/Houses']);
        // Top folder of the workspace has only default information → no record.
        expect(byPath.has('.wiw-folder.yaml')).toBe(false);
        const notes = byPath.get('Notes.md');
        expect(notes && 'text' in notes ? notes.text : null).toBe('# Notes\nPlain.');
        for (const file of plan.files) {
            if ('text' in file) {
                expect(file.text).not.toMatch(/wi_id|kingdoms|varn|e-ab1/);
            }
        }
        expect(plan.urlOnlyImageIds).toEqual(['remote']);
    });

    it('records designation, custom order, captions and URL-only images in the folder record', () => {
        const state = sampleState();
        const plan = planExport({ state, scopeFolderId: state.root.id, yaml })!;
        const record = plan.files.find((file) => file.path === 'Kingdoms/.wiw-folder.yaml');
        const model = parseFolderRecord(record && 'text' in record ? record.text : '', yaml);
        expect(model.root).toBe(true);
        expect(model.book).toBe('Kingdoms East');
        expect(model.title).toBeUndefined();
        expect(model.order).toEqual(['House Varn.md', 'Aldermeer.md', 'Aldermeer map.png', 'Crest.svg', 'Remote portrait', 'Houses']);
        expect(model.images.get('Aldermeer map.png')?.caption).toBe('Old survey');
        expect(model.images.get('Crest.svg')).toBeUndefined();
        expect(model.images.get('Remote portrait')?.src).toBe('https://example.org/p.png');
        const entry = plan.files.find((file) => file.path === 'Kingdoms/Houses/A_B.md');
        expect(entry && 'text' in entry ? entry.text : '').toContain('wi_title: A/B');
    });

    it('exports a subtree into a directory named after the folder', () => {
        const state = sampleState();
        const plan = planExport({ state, scopeFolderId: 'houses', yaml })!;
        expect(plan.baseDir).toBe('Houses');
        expect(plan.files.map((file) => file.path).sort()).toEqual([
            'Houses/.wiw-folder.yaml',
            'Houses/A_B.md',
            'Houses/a_b (2).md',
        ]);
    });

    it('is deterministic across runs with previous paths', () => {
        const state = sampleState();
        const first = planExport({ state, scopeFolderId: state.root.id, yaml })!;
        const second = planExport({ state, scopeFolderId: state.root.id, yaml, previous: first.paths })!;
        expect(second.files).toEqual(first.files);
    });
});
