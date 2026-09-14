import type { TreeNode } from '../state/schema';

/**
 * Typed validation rules (US2 FR-010, US3 publish gating; data-model "Validation
 * rules"). Violations are RETURNED for surfacing — the editor never silently
 * resets or coerces values.
 */

export interface FieldViolation {
    field: string;
    message: string;
}

export interface NodeViolation extends FieldViolation {
    nodeId: string;
}

export const GENERATION_TYPE_TRIGGERS: readonly string[] = [
    'normal',
    'continue',
    'impersonate',
    'swipe',
    'regenerate',
    'quiet',
];

export const POSITION_COUNT = 8;
export const ROLE_COUNT = 3;
export const SELECTIVE_LOGIC_COUNT = 4;

export function validateName(name: string): FieldViolation | null {
    if (name.trim() === '') {
        return { field: 'name', message: 'Name is required.' };
    }
    return null;
}

export function validateNode(node: TreeNode): FieldViolation[] {
    const violations: FieldViolation[] = [];
    const nameViolation = validateName(node.name);
    if (nameViolation) {
        violations.push(nameViolation);
    }
    if (node.kind === 'folder') {
        if (node.book !== null && node.book.bookName.trim() === '') {
            violations.push({ field: 'bookName', message: 'A designated root needs a book name.' });
        }
        return violations;
    }
    if (node.kind === 'image') {
        return violations;
    }

    const native = node.native;
    if (!Number.isFinite(native.probability) || native.probability < 0 || native.probability > 100) {
        violations.push({ field: 'probability', message: 'Probability must be between 0 and 100.' });
    }
    if (!Number.isFinite(native.depth) || native.depth < 0) {
        violations.push({ field: 'depth', message: 'Depth must be 0 or greater.' });
    }
    if (!Number.isInteger(native.position) || native.position < 0 || native.position >= POSITION_COUNT) {
        violations.push({ field: 'position', message: `Position must be 0..${POSITION_COUNT - 1}.` });
    }
    if (!Number.isInteger(native.role) || native.role < 0 || native.role >= ROLE_COUNT) {
        violations.push({ field: 'role', message: `Role must be 0..${ROLE_COUNT - 1}.` });
    }
    if (
        !Number.isInteger(native.selectiveLogic) ||
        native.selectiveLogic < 0 ||
        native.selectiveLogic >= SELECTIVE_LOGIC_COUNT
    ) {
        violations.push({
            field: 'selectiveLogic',
            message: `Selective logic must be 0..${SELECTIVE_LOGIC_COUNT - 1}.`,
        });
    }
    if (native.position === 7 && native.outletName.trim() === '') {
        violations.push({ field: 'outletName', message: 'Outlet position requires an outlet name.' });
    }
    for (const field of ['sticky', 'cooldown', 'delay'] as const) {
        const value = native[field];
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
            violations.push({ field, message: `${field} must be 0 or greater (or empty).` });
        }
    }
    if (!Number.isFinite(native.groupWeight) || native.groupWeight < 0 || native.groupWeight > 100) {
        violations.push({ field: 'groupWeight', message: 'Group weight must be between 0 and 100.' });
    }
    const allowed = new Set<string>(GENERATION_TYPE_TRIGGERS);
    if (native.triggers.some((trigger) => !allowed.has(trigger))) {
        violations.push({ field: 'triggers', message: 'Triggers must use known generation types.' });
    }
    return violations;
}

export function validateTree(state: {
    root: TreeNode;
}): Array<FieldViolation & { nodeId: string }> {
    const violations: Array<FieldViolation & { nodeId: string }> = [];
    const walk = (node: TreeNode): void => {
        for (const violation of validateNode(node)) {
            violations.push({ nodeId: node.id, ...violation });
        }
        if (node.kind === 'folder') {
            node.children.forEach(walk);
        }
    };
    walk(state.root);
    return violations;
}