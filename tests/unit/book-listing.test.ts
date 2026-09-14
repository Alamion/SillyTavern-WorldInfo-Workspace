import { describe, expect, it } from 'vitest';
import { countByFilter, pageBooks, type BookFacts } from '../../src/core/books/listing';

function book(name: string, facts: Partial<BookFacts> = {}): BookFacts {
    return {
        name,
        globallyActive: false,
        characterBound: false,
        chatBound: false,
        workspaceRoot: null,
        workspaceRootId: null,
        ...facts,
    };
}

describe('book listing', () => {
    it('sorts by name with numeric collation and paginates', () => {
        const books = Array.from({ length: 120 }, (_, i) => book(`Book ${120 - i}`));
        const first = pageBooks(books, { query: '', filter: 'all', page: 0 });
        expect(first.total).toBe(120);
        expect(first.pageCount).toBe(3);
        expect(first.items).toHaveLength(50);
        expect(first.items[0]?.name).toBe('Book 1');
        expect(first.items[9]?.name).toBe('Book 10');
        const last = pageBooks(books, { query: '', filter: 'all', page: 2 });
        expect(last.items).toHaveLength(20);
    });

    it('clamps an out-of-range page after the result shrinks', () => {
        const books = [book('Alpha'), book('Beta')];
        expect(pageBooks(books, { query: 'beta', filter: 'all', page: 4 }).page).toBe(0);
    });

    it('filters by activation, character/chat binding and workspace membership', () => {
        const books = [
            book('Global', { globallyActive: true }),
            book('Hero', { characterBound: true }),
            book('Chat', { chatBound: true }),
            book('Bound', { workspaceRoot: 'Realm' }),
            book('Loose'),
        ];
        const names = (filter: Parameters<typeof pageBooks>[1]['filter']): string[] =>
            pageBooks(books, { query: '', filter, page: 0 }).items.map((item) => item.name);
        expect(names('active')).toEqual(['Global']);
        expect(names('context')).toEqual(['Chat', 'Hero']);
        expect(names('workspace')).toEqual(['Bound']);
        expect(names('outside')).toEqual(['Chat', 'Global', 'Hero', 'Loose']);
        expect(countByFilter(books)).toEqual({ all: 5, active: 1, context: 2, workspace: 1, outside: 4 });
    });

    it('searches book names and bound folder names', () => {
        const books = [book('lore-01', { workspaceRoot: 'Realm of Aldermeer' }), book('Aldermeer extras')];
        const found = pageBooks(books, { query: 'alder', filter: 'all', page: 0 });
        expect(found.items.map((item) => item.name)).toEqual(['Aldermeer extras', 'lore-01']);
    });
});
