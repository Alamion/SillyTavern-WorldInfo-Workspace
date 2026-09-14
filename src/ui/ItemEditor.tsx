import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { NativeWorldInfoEntry } from '../global';
import type { ImageResolver } from '../core/preview';
import type { FieldViolation } from '../core/tree/validation';
import type { ImageNode, TreeNode } from '../core/state/schema';
import { NodeHeader } from './NodeHeader';
import { CardEditor } from './fieldGroups/FieldGroups';

export interface ItemEditorProps {
    node: TreeNode | null;
    violations: FieldViolation[];
    membershipLine: string;
    resolveImage?: ImageResolver;
    substitute: (text: string) => string;
    onCommitEntryField: (entryId: string, name: keyof NativeWorldInfoEntry, value: unknown) => void;
    onCommitImage: (imageId: string, patch: { src?: string; caption?: string }) => void;
    /** Uniform name commit for EVERY node kind (entity keeps comment synced). */
    onCommitName: (nodeId: string, name: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleWiRoot: (id: string) => void;
    folderExtras?: (folder: Extract<TreeNode, { kind: 'folder' }>) => ReactNode;
}

export function ItemEditor({
    node,
    violations,
    membershipLine,
    resolveImage,
    substitute,
    onCommitEntryField,
    onCommitImage,
    onCommitName,
    onDuplicate,
    onDelete,
    onToggleWiRoot,
    folderExtras,
}: ItemEditorProps): JSX.Element {
    if (!node) {
        return <div className="wiw-editor-empty">Select an item in the tree to inspect it.</div>;
    }
    const banner =
        violations.length > 0 ? (
            <div className="wiw-banner wiw-banner-warn wiw-save-banner">
                <i className="fa-solid fa-triangle-exclamation" />
                <span>
                    {violations.map((violation) => violation.message).join(' ')} Fix it to
                    unblock the sync.
                </span>
            </div>
        ) : null;
    if (node.kind === 'entry') {
        return (
            <CardEditor
                key={node.id}
                entry={node}
                banner={banner}
                membershipLine={membershipLine}
                resolveImage={resolveImage}
                substitute={substitute}
                onCommitField={(name, value) => onCommitEntryField(node.id, name, value)}
                onCommitName={(value: string) => onCommitName(node.id, value)}
                onToggleDisable={() => onCommitEntryField(node.id, 'disable', !node.native.disable)}
                onDuplicate={() => onDuplicate(node.id)}
                onDelete={() => onDelete(node.id)}
            />
        );
    }
    if (node.kind === 'image') {
        return (
            <ImageEditor
                key={node.id}
                image={node}
                banner={banner}
                onCommitName={(value) => onCommitName(node.id, value)}
                onCommitImage={onCommitImage}
                onDuplicate={() => onDuplicate(node.id)}
                onDelete={() => onDelete(node.id)}
            />
        );
    }
    return (
        <FolderView
            key={node.id}
            folder={node}
            banner={banner}
            onCommitName={(value) => onCommitName(node.id, value)}
            onDuplicate={() => onDuplicate(node.id)}
            onDelete={() => onDelete(node.id)}
            onToggleWiRoot={onToggleWiRoot}
            extras={folderExtras}
        />
    );
}

type ImageSourceMode = 'url' | 'svg' | 'file';

const SVG_DATA_PREFIX = 'data:image/svg+xml,';

function svgToDataUri(svg: string): string {
    return `${SVG_DATA_PREFIX}${encodeURIComponent(svg)}`;
}

function dataUriToSvg(src: string): string {
    try {
        return decodeURIComponent(src.slice(SVG_DATA_PREFIX.length));
    } catch {
        return '';
    }
}

function detectImageMode(src: string): ImageSourceMode {
    if (src.startsWith(SVG_DATA_PREFIX)) {
        return 'svg';
    }
    if (src.startsWith('data:')) {
        return 'file';
    }
    return 'url';
}

function ImageEditor({
    image,
    banner,
    onCommitName,
    onCommitImage,
    onDuplicate,
    onDelete,
}: {
    image: ImageNode;
    banner?: ReactNode;
    onCommitName(name: string): void;
    onCommitImage: ItemEditorProps['onCommitImage'];
    onDuplicate(): void;
    onDelete(): void;
}): JSX.Element {
    const [mode, setMode] = useState<ImageSourceMode>(() => detectImageMode(image.src));
    const [svgDraft, setSvgDraft] = useState<string>(() =>
        detectImageMode(image.src) === 'svg' ? dataUriToSvg(image.src) : ''
    );

    // Keep the textarea in sync when the source changes from elsewhere (demo
    // seed, import, undo).
    useEffect(() => {
        if (detectImageMode(image.src) === 'svg') {
            setMode('svg');
            setSvgDraft(dataUriToSvg(image.src));
        }
    }, [image.src]);

    const switchMode = (next: ImageSourceMode): void => {
        setMode(next);
        if (next === 'svg' && detectImageMode(image.src) !== 'svg') {
            setSvgDraft('');
        }
    };

    const pickFile = (file: File): void => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                onCommitImage(image.id, { src: reader.result });
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="wiw-editor-card wiw-image-view">
            {banner}
            <NodeHeader
                kind="image"
                icon="fa-image"
                name={image.name}
                onCommitName={onCommitName}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
            />
            {image.src === '' ? (
                <div className="wiw-editor-empty">No image source yet — pick one below.</div>
            ) : (
                <img className="wiw-image-preview" src={image.src} alt={image.name} />
            )}
            <div className="wiw-field-grid">
                <div className="wiw-field" style={{ gridColumn: 'span 4' }}>
                    <span className="wiw-field-label">Source type</span>
                    <select
                        value={mode}
                        onChange={(event) => switchMode(event.target.value as ImageSourceMode)}
                    >
                        <option value="url">Resource URL</option>
                        <option value="svg">Plain SVG</option>
                        <option value="file">File (jpg/png/…)</option>
                    </select>
                </div>
                {mode === 'url' && (
                    <div className="wiw-field wiw-field-wide" style={{ gridColumn: 'span 12' }}>
                        <span className="wiw-field-label">Image URL</span>
                        <input
                            type="text"
                            placeholder="https://example.com/image.png"
                            value={image.src.startsWith('data:') ? '' : image.src}
                            onChange={(event) => onCommitImage(image.id, { src: event.target.value })}
                        />
                    </div>
                )}
                {mode === 'svg' && (
                    <div className="wiw-field wiw-field-wide" style={{ gridColumn: 'span 12' }}>
                        <span className="wiw-field-label">SVG markup (stored as a data URI)</span>
                        <textarea
                            className="wiw-svg-editor"
                            spellCheck={false}
                            value={svgDraft}
                            onChange={(event) => {
                                setSvgDraft(event.target.value);
                                onCommitImage(image.id, { src: svgToDataUri(event.target.value) });
                            }}
                        />
                    </div>
                )}
                {mode === 'file' && (
                    <div className="wiw-field wiw-field-wide" style={{ gridColumn: 'span 12' }}>
                        <span className="wiw-field-label">Pick an image file (stored as a data URI)</span>
                        <label className="wiw-button wiw-file-button">
                            <i className="fa-solid fa-folder-open" /> Choose file…
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (file) {
                                        pickFile(file);
                                    }
                                }}
                            />
                        </label>
                    </div>
                )}
                <div className="wiw-field wiw-field-wide" style={{ gridColumn: 'span 12' }}>
                    <span className="wiw-field-label">Caption</span>
                    <input
                        type="text"
                        value={image.caption}
                        onChange={(event) => onCommitImage(image.id, { caption: event.target.value })}
                    />
                </div>
            </div>
        </div>
    );
}

function FolderView({
    folder,
    banner,
    onCommitName,
    onToggleWiRoot,
    onDuplicate,
    onDelete,
    extras,
}: {
    folder: Extract<TreeNode, { kind: 'folder' }>;
    banner?: ReactNode;
    onCommitName(name: string): void;
    onDuplicate(): void;
    onDelete(): void;
    onToggleWiRoot: (id: string) => void;
    extras?: (folder: Extract<TreeNode, { kind: 'folder' }>) => ReactNode;
}): JSX.Element {
    return (
        <div className="wiw-editor-card">
            {banner}
            <NodeHeader
                kind="folder"
                icon="fa-folder"
                name={folder.name}
                onCommitName={onCommitName}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
            />
            <p className="wiw-editor-subtitle">
                {folder.isWiRoot
                    ? 'World Info root - collects every entry beneath it into its own book'
                    : 'Plain folder - organizes items; holds no own content'}
            </p>
            {extras?.(folder)}
            <div className="wiw-editor-actions">
                <button
                    type="button"
                    className="wiw-button"
                    onClick={() => onToggleWiRoot(folder.id)}
                >
                    <i className={`fa-solid ${folder.isWiRoot ? 'fa-toggle-on' : 'fa-toggle-off'}`} />
                    {folder.isWiRoot ? 'Disable World Info root' : 'Make World Info root'}
                </button>
            </div>
        </div>
    );
}