import type { WorkspaceState } from '../state/schema';
import { parseReply } from './parser';
import { withBlocked } from './plan';
import type { Decision, Message, OperationProposal, ProposalBatch } from './types';
import { toProposals, usableBlocks } from './validate';

/**
 * Editing a message in place (owner request 2026-09-22, like the app's own chat).
 * Pure module.
 *
 * An assistant reply is edited as its raw text: prose AND operation blocks, but
 * never the thinking, which stays in `reasoning` untouched. Saving re-parses the
 * text, and the proposals are carried over so no decision or undo record is lost:
 *
 * - a block that is unchanged keeps its proposal as it was (id, decision, user
 *   edits, applied state);
 * - a changed or new block becomes a fresh proposal to review;
 * - a proposal whose block disappeared is dropped — unless it has history (it was
 *   applied or reverted, or an applied batch mentions it): those stay in the
 *   batch as they are, so the change stays visible and can still be undone.
 */

/** Decisions that record something that happened to the workspace. */
const HISTORY: ReadonlySet<Decision> = new Set<Decision>(['applied', 'reverted']);

/** The editable raw text of a message: an assistant reply without its thinking. */
export function editableText(message: Message): string {
    if (message.role !== 'assistant') {
        return message.text;
    }
    return message.text
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^\s*<think(?:ing)?>[\s\S]*$/i, '')
        .trim();
}

/** Proposals paired with the operation block each was parsed from. */
function sourcesOf(message: Message, batch: ProposalBatch): Map<string, string> {
    const sources = new Map<string, string>();
    // Proposals stored before `source` existed: the batch was built from the
    // usable blocks of the same text in the same order.
    const legacy = usableBlocks(parseReply(message.text, { final: true }).blocks);
    const aligned = legacy.length === batch.proposals.length;
    batch.proposals.forEach((proposal, index) => {
        const source = proposal.source ?? (aligned ? legacy[index]?.raw : undefined);
        if (source !== undefined) {
            sources.set(proposal.id, source);
        }
    });
    return sources;
}

function hasHistory(proposal: OperationProposal, batch: ProposalBatch): boolean {
    return (
        HISTORY.has(proposal.decision) ||
        batch.applied.some((applied) => applied.items.some((item) => item.proposalId === proposal.id))
    );
}

export interface EditedReply {
    message: Message;
    /** Proposals whose block changed or is new: they need a fresh review. */
    fresh: number;
    /** Applied or reverted proposals whose block was removed but which are kept. */
    kept: number;
}

/**
 * The message with `text` replaced and everything derived from it re-derived.
 * `state` validates new blocks against the tree as it is now; handles come from
 * the reply's own context snapshot, as when it was received.
 */
export function editMessage(message: Message, text: string, state: WorkspaceState): EditedReply {
    if (message.role !== 'assistant') {
        return { message: { ...message, text }, fresh: 0, kept: 0 };
    }
    const parsed = parseReply(text, { final: true });
    const next: Message = { ...message, text, prose: parsed.prose };
    if (message.mode !== 'propose') {
        return { message: next, fresh: 0, kept: 0 };
    }
    const previous: ProposalBatch = message.batch ?? {
        id: `${message.conversationId}-${String(message.seq)}`,
        proposals: [],
        unparsed: [],
        applied: [],
    };
    const sources = sourcesOf(message, previous);
    const usedIds = new Set(previous.proposals.map((proposal) => proposal.id));
    let counter = 0;
    const newId = (): string => {
        let id: string;
        do {
            counter += 1;
            id = `${String(message.seq)}-${String(counter)}`;
        } while (usedIds.has(id));
        usedIds.add(id);
        return id;
    };
    const candidates = toProposals(parsed.blocks, {
        state,
        snapshot: {
            handles: message.context?.handles ?? {},
            scopeNodeIds: message.context?.scopeNodeIds ?? [],
        },
        newProposalId: newId,
    });

    // Unchanged blocks keep their proposal (first unmatched one with the same block).
    const matched = new Set<string>();
    const renamed = new Map<string, string>();
    const kept = new Map<string, OperationProposal>();
    for (const candidate of candidates) {
        const old = previous.proposals.find(
            (proposal) =>
                !matched.has(proposal.id) &&
                candidate.source !== undefined &&
                sources.get(proposal.id) === candidate.source
        );
        if (old) {
            matched.add(old.id);
            renamed.set(candidate.id, old.id);
            kept.set(old.id, old);
        }
    }
    const remap = (id: string): string => renamed.get(id) ?? id;
    let fresh = 0;
    const proposals: OperationProposal[] = candidates.map((candidate) => {
        const oldId = renamed.get(candidate.id);
        const old = oldId !== undefined ? kept.get(oldId) : undefined;
        if (old) {
            // Dependencies follow the edited text (a sibling block may have changed).
            return { ...old, source: candidate.source, dependsOn: candidate.dependsOn.map(remap) };
        }
        fresh += 1;
        return { ...candidate, dependsOn: candidate.dependsOn.map(remap) };
    });
    const retained = previous.proposals.filter(
        (proposal) => !matched.has(proposal.id) && hasHistory(proposal, previous)
    );
    next.batch = {
        ...previous,
        proposals: withBlocked([...proposals, ...retained]),
        unparsed: parsed.unparsed,
    };
    return { message: next, fresh, kept: retained.length };
}

/**
 * Continuing a cut-off reply (live run 2026-09-22): the model gets the reply so far
 * and writes only what is missing; the rest is appended to the SAME message and the
 * result goes through `editMessage`, so decisions and refs of the cut-off part stay.
 *
 * The part the model continues from: the editable text without an unfinished
 * trailing operation block, which the model is asked to write again in full.
 */
export function continuationBase(message: Message): string {
    const text = editableText(message);
    const lower = text.toLowerCase();
    const lastOpen = lower.search(/<op\b(?![\s\S]*<op\b)/);
    if (lastOpen >= 0 && lower.indexOf('</op>', lastOpen) < 0) {
        return text.slice(0, lastOpen).trimEnd();
    }
    return text;
}

/** The reply so far joined with its continuation (a block always starts a new line). */
export function appendContinuation(base: string, continuation: string): string {
    const rest = continuation.replace(/^\s+/, '');
    if (base === '' || rest === '') {
        return base + rest;
    }
    if (/^<op\b/i.test(rest)) {
        return `${base.trimEnd()}\n${rest}`;
    }
    // Providers trim the leading space of a continuation that ends mid-sentence.
    return /\s$/.test(base) || /^[,.;:!?)]/.test(rest) ? base + rest : `${base} ${rest}`;
}
