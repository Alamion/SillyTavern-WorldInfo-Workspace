import { describe, expect, it } from 'vitest';
import { buildRequest, estimateTokens } from '../../src/core/assistant/context';
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings, type Message } from '../../src/core/assistant/types';
import { createEntryNode, createFolderNode, type EntryNode, type FolderNode, type WorkspaceState } from '../../src/core/state/schema';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/** Context assembly and budget trimming (research R6, FR-021–FR-023). */

const BASE: ContextSettings = DEFAULT_CONTEXT_SETTINGS;

function build(overrides: Partial<Parameters<typeof buildRequest>[0]> = {}) {
    return buildRequest({
        state: aldermeerState(),
        mode: 'propose',
        instructions: null,
        context: BASE,
        selection: [NODE_IDS.cities],
        request: 'Add two taverns',
        history: [],
        contextTokens: 16000,
        responseTokens: 2000,
        ...overrides,
    });
}

function text(built: ReturnType<typeof buildRequest>): string {
    return built.messages.map((message) => message.content).join('\n---\n');
}

describe('message order and content', () => {
    it('keeps rules in the system message and shares the workspace in the user turn (owner report 2026-09-16)', () => {
        const built = build();
        expect(built.messages).toHaveLength(2);
        expect(built.messages[0]?.role).toBe('system');
        expect(built.messages[0]?.content).toContain('lore assistant');
        expect(built.messages[0]?.content).toContain('<op type="create_entry"');
        expect(built.messages[0]?.content).not.toContain('## Workspace structure');
        const last = built.messages.at(-1);
        expect(last?.role).toBe('user');
        expect(last?.content).toMatch(/^<workspace>\n/);
        expect(last?.content).toContain('## Where the user is');
        expect(last?.content).toContain('## Workspace structure');
        expect(last?.content).toMatch(/<\/workspace>\n\nAdd two taverns$/);
    });

    it('renders the structure with handles, kinds, roots, keys and captions', () => {
        const body = text(build({ context: { ...BASE, scope: { kind: 'workspace' } } }));
        expect(body).toContain('f1 | folder | Aldermeer — World Info root');
        expect(body).toContain('  f2 | folder | Cities');
        expect(body).toContain('e1 | entry | Bristlemark — keys: bristlemark, harbor city');
        expect(body).toContain('i1 | image | Aldermeer map — caption: Hand-drawn map of the river delta');
    });

    it('sends entries in full with only non-default fields', () => {
        const body = text(build({ request: 'Expand the harbor city' }));
        expect(body).toContain('[e1] Bristlemark');
        expect(body).toContain('keys: bristlemark, harbor city');
        expect(body).toContain('fields: position=at_depth, depth=2');
        expect(body).toContain('Sells charcoal.');
        expect(body).not.toContain('probability=100');
    });

    it('reports dropped folder ids of a stale scope', () => {
        const built = build({
            context: { ...BASE, scope: { kind: 'folders', folderIds: ['gone'] } },
        });
        expect(built.snapshot.omitted[0]).toMatchObject({ what: 'item', count: 1 });
    });

    it('records the exact messages in the snapshot', () => {
        const built = build();
        expect(built.snapshot.requestMessages).toEqual(built.messages);
        expect(built.snapshot.handles['e1']).toBe(NODE_IDS.bristlemark);
        expect(built.snapshot.estimatedTokens).toBeGreaterThan(0);
    });

    it('uses the discuss protocol in discuss mode', () => {
        const built = build({ mode: 'discuss' });
        expect(built.messages[0]?.content).toContain('Answer in prose only');
        expect(built.messages[0]?.content).not.toContain('<op type="create_entry"');
    });

    it('honours custom instructions', () => {
        const built = build({ instructions: 'Write like a bard.' });
        expect(built.messages[0]?.content).toContain('Write like a bard.');
        expect(built.messages[0]?.content).not.toContain('lore assistant inside');
    });
});

describe('structure scope (owner report 2026-09-16)', () => {
    it('shows only the chosen structure and the folders above it', () => {
        const built = build({
            context: { ...BASE, scope: { kind: 'folders', folderIds: [NODE_IDS.hearth] } },
            selection: [],
        });
        const body = text(built);
        expect(body).toContain('f1 | folder | Aldermeer');
        expect(body).toContain('f2 | folder | Hearth & Home');
        expect(body).not.toContain('Bristlemark');
        expect(body).not.toContain('Cities');
        expect(body).not.toContain('Aldermeer map');
        expect(Object.values(built.snapshot.handles)).toEqual([NODE_IDS.aldermeer, NODE_IDS.hearth]);
        expect(built.snapshot.scopeNodeIds).toContain(NODE_IDS.hearth);
        expect(built.snapshot.scopeNodeIds).not.toContain(NODE_IDS.aldermeer);
        expect(built.snapshot.included.outlineItems).toBe(2);
    });

    it('follows the selection: the selected item’s folder is the structure', () => {
        const built = build({ selection: [NODE_IDS.taverns] });
        const body = text(built);
        expect(body).toContain('f2 | folder | Cities');
        expect(body).not.toContain('Hearth & Home');
    });
});

describe('where the user is (owner report 2026-09-16)', () => {
    it('names the selected item and its folder as the place for new items', () => {
        const body = text(build({ selection: [NODE_IDS.taverns] }));
        expect(body).toContain('Selected in the tree: e2 (entry: Aldermeer / Cities / Bristlemark Taverns)');
        expect(body).toContain('Current folder: f2 (Aldermeer / Cities). Put new items here');
    });

    it('uses the selected folder itself', () => {
        const body = text(
            build({ selection: [NODE_IDS.hearth], context: { ...BASE, scope: { kind: 'workspace' } } })
        );
        expect(body).toContain('Current folder: f3 (Aldermeer / Hearth & Home)');
    });

    it('falls back to the chosen folder when nothing is selected', () => {
        const body = text(
            build({ selection: [], context: { ...BASE, scope: { kind: 'folders', folderIds: [NODE_IDS.cities] } } })
        );
        expect(body).toContain('Nothing is selected in the tree.');
        expect(body).toContain('Current folder: f2 (Aldermeer / Cities)');
    });

    it('says there is no current folder for the whole workspace without a selection', () => {
        const body = text(build({ selection: [], context: { ...BASE, scope: { kind: 'workspace' } } }));
        expect(body).toContain('No current folder');
    });
});

describe('entry contents by keys (owner report 2026-09-16)', () => {
    it('sends no contents when nothing is selected or mentioned', () => {
        const built = build({ request: 'Add two inns', selection: [NODE_IDS.cities] });
        expect(built.snapshot.included.fullItems).toBe(0);
        expect(text(built)).toContain('e1 | entry | Bristlemark');
        expect(text(built)).not.toContain('Sells charcoal.');
    });

    it('sends a selected entry in full', () => {
        const built = build({ request: 'Improve it', selection: [NODE_IDS.taverns] });
        expect(text(built)).toContain('Three taverns share the harbor trade.');
        expect(built.snapshot.included).toMatchObject({ fullItems: 1, triggeredItems: 0 });
    });

    it('sends entries whose keys the request mentions', () => {
        const built = build({ request: 'Tell me about the tavern trade', selection: [NODE_IDS.cities] });
        expect(text(built)).toContain('Three taverns share the harbor trade.');
        // "harbor" alone is not Bristlemark's key ("harbor city").
        expect(text(built)).not.toContain('Sells charcoal.');
        expect(built.snapshot.included).toMatchObject({ fullItems: 1, triggeredItems: 1 });
    });

    it('follows a chain of keys', () => {
        const built = build({
            request: 'Improve it',
            selection: [NODE_IDS.taverns],
            state: (() => {
                const state = aldermeerState();
                const cities = (state.root.children[0] as FolderNode).children[0] as FolderNode;
                const taverns = cities.children[1] as EntryNode;
                taverns.native.content = 'Three taverns serve the harbor city.';
                return state;
            })(),
        });
        expect(text(built)).toContain('Sells charcoal.');
        expect(built.snapshot.included).toMatchObject({ fullItems: 2, triggeredItems: 1 });
    });

    it('matches titles too', () => {
        const built = build({ request: 'Expand Bristlemark Taverns' });
        expect(text(built)).toContain('Three taverns share the harbor trade.');
    });

    it('sends every entry of the structure with `all`', () => {
        const built = build({ request: 'Add two inns', context: { ...BASE, entryContents: 'all' } });
        expect(built.snapshot.included.fullItems).toBe(2);
        // Nothing was chosen by keys (live run 2026-09-16 notice said "48 by keys").
        expect(built.snapshot.included.triggeredItems).toBe(0);
    });

    it('scans enabled chat messages for keys', () => {
        const built = build({
            request: 'What is missing?',
            context: { ...BASE, chatMessages: 5 },
            chat: {
                messages: [{ name: 'Kara', isUser: true, text: 'Take me to an alehouse.' }],
                card: null,
                persona: null,
                activated: [],
            },
        });
        expect(text(built)).toContain('Three taverns share the harbor trade.');
    });
});

describe('history and notes', () => {
    const history: Message[] = [
        {
            conversationId: 'c1',
            seq: 0,
            role: 'user',
            text: 'first request',
            status: 'received',
            mode: 'propose',
            createdAt: 'now',
        },
        {
            conversationId: 'c1',
            seq: 1,
            role: 'assistant',
            text: 'first reply',
            status: 'received',
            mode: 'propose',
            createdAt: 'now',
        },
        {
            conversationId: 'c1',
            seq: 2,
            role: 'note',
            text: 'Decisions: denied create_entry "The Hearthfire Inn" (do not propose again unless asked)',
            status: 'received',
            mode: 'propose',
            createdAt: 'now',
        },
    ];

    it('sends history in order with notes as system messages', () => {
        const built = build({ history });
        const roles = built.messages.map((message) => message.role);
        expect(built.messages.map((message) => message.content)).toContain('first reply');
        expect(built.messages.map((message) => message.content)).toContain(history[2]?.text);
        expect(roles.at(-1)).toBe('user');
    });

    it('drops the oldest turns first when the budget is tight', () => {
        const long: Message[] = Array.from({ length: 30 }, (_unused, index) => ({
            conversationId: 'c1',
            seq: index,
            role: index % 2 === 0 ? 'user' : 'assistant',
            text: `turn ${String(index)} ${'lore '.repeat(200)}`,
            status: 'received',
            mode: 'propose',
            createdAt: 'now',
        }));
        const built = build({ history: long, contextTokens: 3000, responseTokens: 500 });
        expect(built.snapshot.omitted.some((part) => part.what === 'history')).toBe(true);
        const body = text(built);
        expect(body).toContain('turn 29');
        expect(body).not.toContain('turn 0 ');
    });
});

describe('budget', () => {
    function bigWorkspace(entries: number): WorkspaceState {
        const state = aldermeerState();
        const folder = createFolderNode({ id: 'big', parentId: state.root.id, name: 'Big', now: 'now' });
        for (let index = 0; index < entries; index += 1) {
            const entry = createEntryNode({
                id: `big-${String(index)}`,
                parentId: folder.id,
                name: `Entry ${String(index)}`,
                now: 'now',
                nativeUid: 1000 + index,
            });
            entry.native.key = [`key${String(index)}`];
            entry.native.content = `Lore body ${String(index)}. ${'Detail sentence. '.repeat(30)}`;
            folder.children.push(entry);
        }
        state.root.children.push(folder);
        return state;
    }

    it('stays inside the limit on a 300-entry workspace and reports what was left out', () => {
        const state = bigWorkspace(300);
        const started = performance.now();
        const built = buildRequest({
            state,
            mode: 'propose',
            instructions: null,
            context: { ...BASE, scope: { kind: 'workspace' }, entryContents: 'all' },
            selection: [],
            request: 'Reorganize the big folder',
            history: [],
            contextTokens: 8000,
            responseTokens: 1000,
        });
        const elapsed = performance.now() - started;
        expect(built.snapshot.estimatedTokens).toBeLessThanOrEqual(8000);
        expect(built.snapshot.omitted.length).toBeGreaterThan(0);
        expect(built.snapshot.included.fullItems).toBeLessThan(300);
        expect(elapsed).toBeLessThan(200);
    });

    it('keeps user-selected items over the rest of the scope', () => {
        const state = bigWorkspace(200);
        const built = buildRequest({
            state,
            mode: 'propose',
            instructions: null,
            context: { ...BASE, scope: { kind: 'workspace' }, entryContents: 'all' },
            selection: ['big-150'],
            request: 'Improve this one',
            history: [],
            contextTokens: 4000,
            responseTokens: 500,
        });
        expect(built.messages.map((message) => message.content).join('\n')).toContain('Lore body 150.');
    });

    it('estimateTokens is conservative', () => {
        expect(estimateTokens('a'.repeat(35))).toBe(10);
    });
});

describe('optional chat sources (US6)', () => {
    const chat = {
        messages: [
            { name: 'Kara', isUser: true, text: 'What about the harbor?' },
            { name: 'Guide', isUser: false, text: 'The guilds run it.' },
        ],
        card: {
            name: 'Guide',
            description: 'A weathered harbor guide.',
            personality: 'Dry humour.',
            scenario: 'Standing on the quay.',
        },
        persona: { name: 'Kara', description: 'A travelling scribe.' },
        activated: [{ bookName: 'Aldermeer', uid: 1 }],
    };

    it('sends nothing chat-related by default', () => {
        const built = build({ chat });
        const body = text(built);
        expect(body).not.toContain('Current chat');
        expect(body).not.toContain('Character card');
        expect(built.snapshot.included).toMatchObject({
            chatMessages: 0,
            characterCard: false,
            persona: false,
            activatedEntries: 0,
        });
    });

    it('sends the enabled sources and maps activated entries to handles', () => {
        const built = build({
            chat,
            context: {
                ...BASE,
                chatMessages: 10,
                characterCard: true,
                persona: true,
                activatedEntries: true,
            },
        });
        const body = text(built);
        expect(body).toContain('Kara: What about the harbor?');
        expect(body).toContain('A weathered harbor guide.');
        expect(body).toContain('A travelling scribe.');
        expect(body).toContain('activated in the current chat\ne1');
        expect(body).toContain('Sells charcoal.');
        expect(built.snapshot.included).toMatchObject({
            chatMessages: 2,
            characterCard: true,
            persona: true,
            activatedEntries: 1,
        });
    });

    it('reports activated entries that are not in the workspace', () => {
        const built = build({
            chat: { ...chat, activated: [{ bookName: 'Other', uid: 42 }] },
            context: { ...BASE, activatedEntries: true },
        });
        expect(built.snapshot.omitted.some((part) => part.label.includes('activated entries outside'))).toBe(
            true
        );
    });
});

describe('context items (spec 007 FR-001/FR-002, research R3)', () => {
    const items = (built: ReturnType<typeof buildRequest>) => built.snapshot.items ?? [];
    const entryItem = (built: ReturnType<typeof buildRequest>, nodeId: string) =>
        items(built).find((item) => item.kind === 'entry' && item.nodeId === nodeId);

    it('marks a selected entry as selected and costs it', () => {
        const built = build({ selection: [NODE_IDS.taverns], request: 'Polish this' });
        const item = entryItem(built, NODE_IDS.taverns);
        expect(item).toMatchObject({ reason: 'selected', state: 'included', label: 'Bristlemark Taverns' });
        expect(item?.tokens).toBeGreaterThan(0);
    });

    it('names the matching key of a key-triggered entry', () => {
        const built = build({ selection: [], request: 'Add an alehouse' });
        expect(entryItem(built, NODE_IDS.taverns)).toMatchObject({ reason: 'key', detail: 'key "alehouse"' });
    });

    it('names the step and the source of a recursion', () => {
        // Chain: request → taverns ("alehouse"), taverns content → Bristlemark ("harbor city").
        const built = build({
            state: (() => {
                const s = aldermeerState();
                const cities = (s.root.children[0] as FolderNode).children[0] as FolderNode;
                const tav = cities.children[1] as EntryNode;
                tav.native.content = 'Three taverns share the trade of the harbor city.';
                return s;
            })(),
            selection: [],
            request: 'Add an alehouse',
        });
        expect(entryItem(built, NODE_IDS.bristlemark)).toMatchObject({
            reason: 'recursion',
            detail: 'step 1 from "Bristlemark Taverns" (key "harbor city")',
        });
    });

    it('lists entries that did not fit as omitted for budget', () => {
        const state = aldermeerState();
        const cities = (state.root.children[0] as FolderNode).children[0] as FolderNode;
        (cities.children[1] as EntryNode).native.content = 'alehouse '.repeat(4000);
        const built = build({ state, selection: [NODE_IDS.taverns], contextTokens: 2600, responseTokens: 500 });
        expect(entryItem(built, NODE_IDS.taverns)).toMatchObject({ state: 'omitted', omitReason: 'budget' });
    });

    it('describes the outline, the request and optional sources', () => {
        const built = build({
            context: { ...BASE, chatMessages: 5, persona: true },
            chat: {
                messages: [{ name: 'Ann', text: 'Hello', isUser: true }],
                card: null,
                persona: { name: 'Ann', description: 'A traveller.' },
                activated: [],
            },
        });
        const kinds = items(built).map((item) => item.kind);
        expect(kinds).toEqual(expect.arrayContaining(['request', 'outline', 'chat', 'persona']));
        expect(items(built).find((item) => item.kind === 'chat')).toMatchObject({ detail: '1 message' });
    });

    it('marks every entry as in scope with the "all" contents mode', () => {
        const built = build({ context: { ...BASE, entryContents: 'all', scope: { kind: 'workspace' } }, selection: [] });
        expect(entryItem(built, NODE_IDS.bristlemark)).toMatchObject({ reason: 'scope' });
    });

    it('item costs add up to the request estimate', () => {
        const built = build({ selection: [NODE_IDS.taverns], request: 'Add an alehouse' });
        const sum = items(built)
            .filter((item) => item.state !== 'omitted')
            .reduce((total, item) => total + item.tokens, 0);
        expect(sum).toBe(built.snapshot.estimatedTokens);
    });
});

describe('catalog mode (spec 007 FR-008/FR-009)', () => {
    function bigState(): WorkspaceState {
        const state = aldermeerState();
        const cities = (state.root.children[0] as FolderNode).children[0] as FolderNode;
        for (let i = 0; i < 60; i++) {
            const entry = createEntryNode({ id: `big-${String(i)}`, parentId: cities.id, name: `District ${String(i)}`, now: '2026-10-07T00:00:00.000Z', nativeUid: 100 + i });
            entry.native.key = ['district'];
            entry.native.content = `District ${String(i)} lies along the canal. `.repeat(40);
            cities.children.push(entry);
        }
        return state;
    }
    const catalogText = (built: ReturnType<typeof buildRequest>) => built.messages.at(-1)?.content ?? '';

    it('Auto leaves a library that fits exactly as before (no catalog)', () => {
        const auto = build({ context: { ...BASE, catalog: 'auto' } });
        const off = build({ context: { ...BASE, catalog: 'off' } });
        expect(auto.messages).toEqual(off.messages);
        expect(catalogText(auto)).not.toContain('## Catalog');
        expect(auto.snapshot.catalogOnlyNodeIds ?? []).toEqual([]);
    });

    it('Auto switches to the catalog when the triggered text overflows', () => {
        const built = build({
            state: bigState(),
            context: { ...BASE, catalog: 'auto', scope: { kind: 'workspace' } },
            selection: [],
            request: 'Which district has the oldest canal?',
            contextTokens: 6000,
            responseTokens: 1000,
        });
        expect(catalogText(built)).toContain('## Catalog');
        expect(built.snapshot.catalogOnlyNodeIds?.length).toBeGreaterThan(0);
        const catalogItem = built.snapshot.items?.find((item) => item.kind === 'catalog');
        expect(catalogItem).toMatchObject({ state: 'included' });
        expect(catalogItem?.detail).toMatch(/entries/);
    });

    it('Off never uses the catalog, even when entries are left out', () => {
        const built = build({
            state: bigState(),
            context: { ...BASE, catalog: 'off', scope: { kind: 'workspace' } },
            selection: [],
            request: 'Which district has the oldest canal?',
            contextTokens: 6000,
            responseTokens: 1000,
        });
        expect(catalogText(built)).not.toContain('## Catalog');
    });

    it('On uses the catalog for a small library too, keeping selected entries in full', () => {
        const built = build({ context: { ...BASE, catalog: 'on', scope: { kind: 'workspace' } }, selection: [NODE_IDS.taverns] });
        expect(catalogText(built)).toContain('## Catalog');
        expect(built.snapshot.catalogOnlyNodeIds).not.toContain(NODE_IDS.taverns);
        expect(built.snapshot.items?.find((item) => item.nodeId === NODE_IDS.taverns)?.state).toBe('included');
    });

    it('sends the summary line with entries in full', () => {
        const state = aldermeerState();
        const cities = (state.root.children[0] as FolderNode).children[0] as FolderNode;
        (cities.children[1] as EntryNode).native.extensions = { wiw_summary: 'When drinking.' };
        expect(catalogText(build({ state, selection: [NODE_IDS.taverns] }))).toContain('summary: When drinking.');
    });
});
