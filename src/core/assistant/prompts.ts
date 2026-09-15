import { DISCUSS_PROTOCOL_TEXT, PROPOSE_PROTOCOL_TEXT } from './protocol';
import type { AssistantMode, OperationProposal, ProposalBatch } from './types';

/**
 * Default assistant instructions and mode rules (spec 005 FR-024). Written for
 * small and free models: short rules, explicit formatting, no cleverness.
 */
export const DEFAULT_INSTRUCTIONS = [
    'You are a lore assistant inside a World Info workspace for a roleplay app.',
    'You help the user write, improve and organize lore entries.',
    'Write vivid, concrete prose: concrete nouns, sensory detail, no filler and no purple padding.',
    'Keep every entry self-contained, a few sentences to a few short paragraphs, and consistent',
    'with the lore you were given. Never invent facts that contradict existing entries.',
    'Keywords are the words a chat message must contain for the entry to be used: pick a few',
    'specific ones, lowercase, no duplicates.',
    'Answer in the language the user writes in.',
].join('\n');

export function systemPrompt(mode: AssistantMode, instructions: string | null): string {
    const head = instructions ?? DEFAULT_INSTRUCTIONS;
    const protocol = mode === 'propose' ? PROPOSE_PROTOCOL_TEXT : DISCUSS_PROTOCOL_TEXT;
    return `${head}\n\n${protocol}`;
}


function label(proposal: OperationProposal): string {
    const values = proposal.userEdited ?? proposal.values;
    const name = values.title !== undefined ? ` "${values.title}"` : '';
    return `${proposal.op}${name}`;
}

/**
 * Compact decision memory for the next request (spec 005 FR-033): what the user
 * accepted, denied and undid, so denied ideas are not proposed again.
 */
export function decisionNote(batch: ProposalBatch | undefined): string | null {
    if (!batch || batch.proposals.length === 0) {
        return null;
    }
    const applied = batch.proposals.filter((proposal) => proposal.decision === 'applied');
    const reverted = batch.proposals.filter((proposal) => proposal.decision === 'reverted');
    const denied = batch.proposals.filter(
        (proposal) => proposal.decision === 'denied' || proposal.decision === 'superseded'
    );
    const parts: string[] = [];
    if (applied.length > 0) {
        parts.push(`accepted ${applied.map(label).join(', ')}`);
    }
    if (reverted.length > 0) {
        parts.push(`accepted then undone ${reverted.map(label).join(', ')}`);
    }
    if (denied.length > 0) {
        parts.push(`denied ${denied.map(label).join(', ')} (do not propose again unless asked)`);
    }
    return parts.length === 0 ? null : `Decisions on your previous proposals: ${parts.join('; ')}.`;
}
