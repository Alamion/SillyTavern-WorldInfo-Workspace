import { describe, expect, it } from 'vitest';
import { appendContinuation, continuationBase, editableText, editMessage } from '../../src/core/assistant/editReply';
import type { Message, OperationProposal } from '../../src/core/assistant/types';
import { aldermeerState } from '../fixtures/assistant/outline-aldermeer';

/** Editing a message in place (owner request 2026-09-22). */

const BLOCK = (title: string): string =>
    `<op type="create_entry" parent="f2"><title>${title}</title><content>x</content></op>`;

function reply(text: string, proposals: OperationProposal[] = []): Message {
    return {
        conversationId: 'c1',
        seq: 1,
        role: 'assistant',
        text,
        status: 'received',
        mode: 'propose',
        createdAt: '2026-09-22T00:00:00.000Z',
        batch: { id: 'c1-1', proposals, unparsed: [], applied: [] },
    };
}

function proposal(id: string, title: string, decision: OperationProposal['decision'], source?: string): OperationProposal {
    const value: OperationProposal = {
        id,
        op: 'create_entry',
        values: { title, content: 'x' },
        dependsOn: [],
        destructive: false,
        decision,
        summary: `Create ${title}`,
    };
    if (source !== undefined) {
        value.source = source;
    }
    return value;
}

describe('editableText', () => {
    it('drops thinking spans and keeps operation blocks', () => {
        const message = reply(`<think>secret</think>Prose\n${BLOCK('A')}`);
        expect(editableText(message)).toBe(`Prose\n${BLOCK('A')}`);
    });

    it('returns user text unchanged', () => {
        expect(editableText({ ...reply('x'), role: 'user', text: ' hi <think>x</think> ' })).toBe(' hi <think>x</think> ');
    });
});

describe('editMessage', () => {
    const state = aldermeerState();

    it('pairs legacy proposals without a stored block by order', () => {
        const text = `${BLOCK('A')}${BLOCK('B')}`;
        const message = reply(text, [proposal('1-1', 'A', 'denied'), proposal('1-2', 'B', 'pending')]);
        const edited = editMessage(message, `${BLOCK('A')}${BLOCK('C')}`, state);
        const [kept, fresh] = edited.message.batch?.proposals ?? [];
        expect([kept?.id, kept?.values.title, kept?.decision]).toEqual(['1-1', 'A', 'denied']);
        expect(fresh?.values.title).toBe('C');
        expect(['1-1', '1-2']).not.toContain(fresh?.id);
        expect(edited.fresh).toBe(1);
    });

    it('never reuses an id of a kept proposal', () => {
        const message = reply(BLOCK('A'), [proposal('1-1', 'A', 'applied', BLOCK('A'))]);
        message.batch?.applied.push({
            id: 'b1',
            appliedAt: '2026-09-22T00:00:00.000Z',
            items: [{ proposalId: '1-1', op: 'create_entry', nodeId: 'n1', afterUpdatedAt: '', inverse: { kind: 'delete-created' } }],
        });
        const edited = editMessage(message, BLOCK('Z'), state);
        const ids = edited.message.batch?.proposals.map((item) => item.id) ?? [];
        expect(ids).toHaveLength(2);
        expect(ids[1]).toBe('1-1');
        expect(ids[0]).not.toBe('1-1');
        expect(edited.kept).toBe(1);
    });

    it('re-links dependencies of a kept proposal to the edited creation', () => {
        const folder = '<op type="create_folder" parent="f2" ref="new1"><title>Inns</title></op>';
        const child = '<op type="create_entry" parent="new1"><title>Inn</title><content>x</content></op>';
        const first = editMessage(reply(''), `${folder}${child}`, state).message;
        const [, childProposal] = first.batch?.proposals ?? [];
        const edited = editMessage(first, `${folder.replace('Inns', 'Hostels')}${child}`, state).message;
        const [newFolder, keptChild] = edited.batch?.proposals ?? [];
        expect(keptChild?.id).toBe(childProposal?.id);
        expect(keptChild?.dependsOn).toEqual([newFolder?.id]);
    });

    it('in discuss mode only the text and prose change', () => {
        const message = { ...reply('old'), mode: 'discuss' as const };
        delete message.batch;
        const edited = editMessage(message, `new ${BLOCK('A')}`, state).message;
        expect(edited.batch).toBeUndefined();
        expect(edited.prose).toBe('new');
    });
});

describe('continuing a cut-off reply (live run 2026-09-22)', () => {
    it('drops an unfinished trailing block and the thinking from the base', () => {
        const text = `<think>plan</think>Two entries.\n${BLOCK('A')}\n<op type="create_entry" parent="f2"><title>B`;
        expect(continuationBase(reply(text))).toBe(`Two entries.\n${BLOCK('A')}`);
    });

    it('keeps a base that stopped in prose', () => {
        expect(continuationBase(reply(`${BLOCK('A')}\nThe harbor is`))).toBe(`${BLOCK('A')}\nThe harbor is`);
    });

    it('joins a block on its own line and prose with one space', () => {
        expect(appendContinuation(BLOCK('A'), `  ${BLOCK('B')}`)).toBe(`${BLOCK('A')}\n${BLOCK('B')}`);
        expect(appendContinuation('The harbor is', 'loud at dawn.')).toBe('The harbor is loud at dawn.');
        expect(appendContinuation('The harbor is ', 'loud.')).toBe('The harbor is loud.');
        expect(appendContinuation('The harbor', ', at dawn')).toBe('The harbor, at dawn');
    });
});
