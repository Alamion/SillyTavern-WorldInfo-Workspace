import { describe, expect, it } from 'vitest';
import { buildRequest, estimateTokens } from '../../src/core/assistant/context';
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings, type Message } from '../../src/core/assistant/types';
import { createEntryNode, createFolderNode, type WorkspaceState } from '../../src/core/state/schema';
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
    it('puts instructions first, then the workspace, then the request', () => {
        const built = build();
        expect(built.messages[0]?.role).toBe('system');
        expect(built.messages[0]?.content).toContain('lore assistant');
        expect(built.messages[0]?.content).toContain('<op type="create_entry"');
        expect(built.messages[1]?.content).toContain('## Workspace outline');
        expect(built.messages.at(-1)).toEqual({ role: 'user', content: 'Add two taverns' });
    });

    it('renders the outline with handles, kinds, roots, keys and captions', () => {
        const body = text(build());
        expect(body).toContain('f1 | folder | Aldermeer — World Info root');
        expect(body).toContain('  f2 | folder | Cities');
        expect(body).toContain('e1 | entry | Bristlemark — keys: bristlemark, harbor city');
        expect(body).toContain('i1 | image | Aldermeer map — caption: Hand-drawn map of the river delta');
    });

    it('sends in-scope entries in full with only non-default fields', () => {
        const body = text(build());
        expect(body).toContain('[e1] Bristlemark');
        expect(body).toContain('keys: bristlemark, harbor city');
        expect(body).toContain('fields: position=at_depth, depth=2');
        expect(body).toContain('Sells charcoal.');
        expect(body).not.toContain('probability=100');
    });

    it('limits full items to the scope', () => {
        const scoped = build({
            context: { ...BASE, scope: { kind: 'folders', folderIds: [NODE_IDS.hearth] } },
        });
        expect(text(scoped)).not.toContain('[e1] Bristlemark');
        expect(scoped.snapshot.included.fullItems).toBe(0);
        // The outline still names it so the assistant can place new items.
        expect(text(scoped)).toContain('e1 | entry | Bristlemark');
        expect(scoped.snapshot.scopeNodeIds).toContain(NODE_IDS.hearth);
        expect(scoped.snapshot.scopeNodeIds).not.toContain(NODE_IDS.bristlemark);
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

    it('omits the outline when the conversation turned it off', () => {
        const built = build({ context: { ...BASE, includeOutline: false } });
        expect(text(built)).not.toContain('## Workspace outline');
        expect(built.snapshot.included.outline).toBe(false);
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
            context: { ...BASE, scope: { kind: 'workspace' } },
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
            context: { ...BASE, scope: { kind: 'workspace' } },
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
        expect(built.snapshot.omitted.some((part) => part.label.includes('activated entries'))).toBe(
            true
        );
    });
});
