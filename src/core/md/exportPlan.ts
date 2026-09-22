import { findNode, type FolderNode, type WorkspaceState } from '../state/schema';
import { renderEntryFile, renderFolderRecord } from './convention';
import { FOLDER_RECORD_NAME, assignPaths, sanitizeStem, splitName } from './naming';
import { baseName, joinPath, type RelPath, type YamlCodec } from './ports';

/**
 * Pure export plan (spec 004 US1): which files a workspace subtree becomes. Image
 * bytes are resolved later by the runner; everything else is rendered here.
 */

export type PlannedFile =
    | { kind: 'entry'; nodeId: string; path: RelPath; text: string }
    | { kind: 'record'; nodeId: string; path: RelPath; text: string }
    | { kind: 'image'; nodeId: string; path: RelPath; src: string };

export interface ExportPlan {
    /** Directory the scope folder maps to ('' for the workspace root). */
    baseDir: RelPath;
    directories: RelPath[];
    files: PlannedFile[];
    /** Every node id of the scope with its assigned path (folders included). */
    paths: Map<string, RelPath>;
    /** Image nodes without a file (external URLs), recorded in folder records. */
    urlOnlyImageIds: string[];
}

export function planExport(input: {
    state: WorkspaceState;
    scopeFolderId: string;
    yaml: YamlCodec;
    previous?: ReadonlyMap<string, RelPath>;
}): ExportPlan | null {
    const scope = findNode(input.state, input.scopeFolderId);
    if (scope?.kind !== 'folder') {
        return null;
    }
    const isWorkspaceRoot = scope.id === input.state.root.id;
    const baseDir = isWorkspaceRoot ? '' : sanitizeStem(scope.name);
    return planFolderTree(scope, baseDir, isWorkspaceRoot, input.yaml, input.previous ?? new Map());
}

/** Shared by export and the link manager (whole-workspace render). */
export function planFolderTree(
    scope: FolderNode,
    baseDir: RelPath,
    scopeIsTop: boolean,
    yaml: YamlCodec,
    previous: ReadonlyMap<string, RelPath>,
    options: {
        /**
         * Skips rendering entry file TEXT, leaving paths and folder records.
         *
         * The link manager re-renders entries itself through an identity-keyed
         * memo, so rendering them here too meant every entry was rendered TWICE
         * on every push and the second render's cache could never pay for the
         * first (spec 006 R8).
         */
        skipEntryText?: boolean;
    } = {}
): ExportPlan {
    const paths = assignPaths(scope, previous, baseDir);
    const directories: RelPath[] = [];
    const files: PlannedFile[] = [];
    const urlOnlyImageIds: string[] = [];
    const visit = (folder: FolderNode, dir: RelPath, isTop: boolean): void => {
        if (dir !== '') {
            directories.push(dir);
        }
        const childNames = new Map<string, string>();
        for (const child of folder.children) {
            const path = paths.get(child.id);
            if (path !== undefined) {
                childNames.set(child.id, baseName(path));
            }
        }
        const record = renderFolderRecord(
            { folder, dirName: isTop && scopeIsTop ? null : baseName(dir), childNames },
            yaml
        );
        if (record !== null) {
            files.push({ kind: 'record', nodeId: folder.id, path: joinPath(dir, FOLDER_RECORD_NAME), text: record });
        }
        for (const child of folder.children) {
            const path = paths.get(child.id);
            if (child.kind === 'folder') {
                if (path !== undefined) {
                    visit(child, path, false);
                }
            } else if (child.kind === 'entry') {
                if (path !== undefined) {
                    files.push({
                        kind: 'entry',
                        nodeId: child.id,
                        path,
                        text: options.skipEntryText
                            ? ''
                            : renderEntryFile(child, splitName(baseName(path)).stem, yaml),
                    });
                }
            } else if (path === undefined) {
                if (child.src !== '') {
                    urlOnlyImageIds.push(child.id);
                }
            } else {
                files.push({ kind: 'image', nodeId: child.id, path, src: child.src });
            }
        }
    };
    visit(scope, baseDir, true);
    return { baseDir, directories, files, paths, urlOnlyImageIds };
}
