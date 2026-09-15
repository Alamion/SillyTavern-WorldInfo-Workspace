import { describe, expect, it } from 'vitest';
import { buildHandleMap, nodeIdOf } from '../../src/core/assistant/handles';
import { NODE_IDS, aldermeerState } from '../fixtures/assistant/outline-aldermeer';

describe('buildHandleMap (research R5)', () => {
    const state = aldermeerState();

    it('numbers folders, entries and images separately in tree order', () => {
        const map = buildHandleMap(state);
        expect(map.handles).toEqual({
            f1: NODE_IDS.aldermeer,
            f2: NODE_IDS.cities,
            e1: NODE_IDS.bristlemark,
            e2: NODE_IDS.taverns,
            f3: NODE_IDS.hearth,
            i1: NODE_IDS.map,
        });
        expect(map.byNode.get(NODE_IDS.taverns)).toBe('e2');
    });

    it('is stable for the same state and resolves back to node ids', () => {
        expect(buildHandleMap(state).handles).toEqual(buildHandleMap(state).handles);
        expect(nodeIdOf(buildHandleMap(state), 'e1')).toBe(NODE_IDS.bristlemark);
        expect(nodeIdOf(buildHandleMap(state), 'e9')).toBeUndefined();
    });

    it('can be limited to a subset of nodes', () => {
        const map = buildHandleMap(state, new Set([NODE_IDS.hearth, NODE_IDS.bristlemark]));
        expect(map.handles).toEqual({ e1: NODE_IDS.bristlemark, f1: NODE_IDS.hearth });
    });

    it('distinguishes items with the same name', () => {
        const twins = aldermeerState();
        const cities = twins.root.children[0]?.kind === 'folder' ? twins.root.children[0].children[0] : undefined;
        if (cities?.kind !== 'folder' || cities.children[1] === undefined) {
            throw new Error('fixture changed');
        }
        cities.children[1].name = 'Bristlemark';
        const map = buildHandleMap(twins);
        expect(map.handles['e1']).not.toBe(map.handles['e2']);
    });
});
