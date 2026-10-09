import type { LlmMessage } from '../assistant/types';
import type { FolderNode, ImageNode, WorkspaceState } from '../state/schema';
import { findNode } from '../state/schema';

/**
 * Caption requests (spec 009 US3/US4, research R3/R5): one instruction and the
 * picture, sent to a vision-capable model through a connection profile.
 */

export function buildCaptionRequest(image: ImageNode, pictureDataUrl: string, instruction: string): LlmMessage[] {
    return [
        {
            role: 'user',
            content: `${instruction}\n\nPicture name: ${image.name}`,
            images: [pictureDataUrl],
        },
    ];
}

/** The caption from a reply: no "Here's a caption:" preamble, quotes or label. */
export function cleanCaptionReply(reply: string): string {
    let text = reply.trim();
    text = text.replace(/^(?:sure[,!.]?\s*)?here(?:'s| is) (?:a |the |an )?(?:one[- ]sentence |short |brief )?(?:caption|description)[^:\n]*:\s*/i, '');
    text = text.replace(/^(?:\*\*)?caption(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i, '');
    const quoted = /^["'«“](.*)["'»”]$/s.exec(text.trim());
    if (quoted?.[1] !== undefined) {
        text = quoted[1];
    }
    return text.trim();
}

/** Images below the folder (any depth, tree order) with a picture and no caption. */
export function selectUncaptioned(state: WorkspaceState, folderId: string): ImageNode[] {
    const folder = findNode(state, folderId);
    if (folder?.kind !== 'folder') {
        return [];
    }
    const found: ImageNode[] = [];
    const walk = (node: FolderNode): void => {
        for (const child of node.children) {
            if (child.kind === 'image') {
                if (child.src.trim() !== '' && child.caption.trim() === '') {
                    found.push(child);
                }
            } else if (child.kind === 'folder') {
                walk(child);
            }
        }
    };
    walk(folder);
    return found;
}
