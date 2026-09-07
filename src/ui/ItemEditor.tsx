import { useState } from 'react';
import type { SampleFolderNode, SampleNode } from '../core/sample/dataset';
import type { ImageResolver } from '../core/sample/markdown';
import { CardEditor, FieldControl } from './fieldGroups/FieldGroups';
import { FIELD_SCHEMA } from '../core/sample/fieldGroups';

const FIELD_MAP = new Map(FIELD_SCHEMA.map((meta) => [meta.name as string, meta]));

function meta(name: string) {
    const found = FIELD_MAP.get(name);
    if (!found) {
        throw new Error(`unmapped field: ${name}`);
    }
    return found;
}

function FolderSettingsView({
    folder,
    onToggleWiRoot,
}: {
    folder: SampleFolderNode;
    onToggleWiRoot: (id: string) => void;
}): JSX.Element {
    const [settings, setSettings] = useState(folder.wiSettings);
    if (!settings) {
        return <div className="wiw-editor-empty">This folder is not a World Info root.</div>;
    }
    const set = (name: string, value: unknown): void => {
        setSettings((prev) => (prev ? { ...prev, [name]: value } : prev));
    };
    const value = (name: string): unknown => {
        const current = folder.wiSettings;
        if (current && settings === folder.wiSettings) {
            return current[name as keyof typeof current];
        }
        return settings[name as keyof typeof settings];
    };
    return (
        <div className="wiw-editor-card">
            <h3 className="wiw-editor-title">{folder.name}</h3>
            <p className="wiw-editor-subtitle">
                World Info root - collects every entry beneath it into its own book
            </p>
            <div className="wiw-field-group">
                <div className="wiw-field-grid">
                    <FieldControl
                        meta={meta('outletName')}
                        span={6}
                        value={value('bookName')}
                        onChange={(next) => set('bookName', next)}
                    />
                    <FieldControl
                        meta={meta('scanDepth')}
                        span={3}
                        value={value('scanDepthOverride')}
                        onChange={(next) => set('scanDepthOverride', next)}
                    />
                    <FieldControl
                        meta={meta('caseSensitive')}
                        span={3}
                        value={value('caseSensitiveOverride')}
                        onChange={(next) => set('caseSensitiveOverride', next)}
                    />
                    <div className="wiw-field" style={{ gridColumn: 'span 3' }}>
                        <span className="wiw-field-label">Recursive scanning</span>
                        <input
                            type="checkbox"
                            checked={Boolean(value('recursiveScanning'))}
                            onChange={(event) => set('recursiveScanning', event.target.checked)}
                        />
                    </div>
                </div>
            </div>
            <div className="wiw-field-group">
                <div className="wiw-field-grid">
                    <FieldControl
                        meta={meta('comment')}
                        span={12}
                        value={value('notes')}
                        onChange={(next) => set('notes', next)}
                    />
                </div>
            </div>
            <button
                type="button"
                className="wiw-button wiw-danger-button"
                onClick={() => onToggleWiRoot(folder.id)}
            >
                <i className="fa-solid fa-toggle-on" /> Disable World Info root
            </button>
        </div>
    );
}

function PlainFolderView({
    folder,
    onToggleWiRoot,
    onDuplicate,
    onDelete,
}: {
    folder: SampleFolderNode;
    onToggleWiRoot: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
}): JSX.Element {
    return (
        <div className="wiw-editor-card">
            <h3 className="wiw-editor-title">{folder.name}</h3>
            <p className="wiw-editor-subtitle">
                Plain folder - collects entries beneath it, holds no own content
            </p>
            <div className="wiw-editor-actions">
                <button type="button" className="wiw-button" onClick={() => onToggleWiRoot(folder.id)}>
                    <i className="fa-solid fa-toggle-off" /> Make World Info root
                </button>
                <button type="button" className="wiw-button wiw-icon-button" title="Duplicate this folder" onClick={() => onDuplicate(folder.id)}>
                    <i className="fa-solid fa-clone" />
                </button>
                <button type="button" className="wiw-button wiw-icon-button" title="Delete this folder" onClick={() => onDelete(folder.id)}>
                    <i className="fa-solid fa-trash-can" />
                </button>
            </div>
        </div>
    );
}

export function ItemEditor({
    selected,
    resolveImage,
    onToggleWiRoot,
    onDuplicate,
    onDelete,
}: {
    selected: SampleNode | null;
    resolveImage?: ImageResolver;
    onToggleWiRoot: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
}): JSX.Element {
    if (!selected) {
        return (
            <div className="wiw-editor-empty">Select an item in the tree to inspect it.</div>
        );
    }
    if (selected.kind === 'entry') {
        return (
            <CardEditor
                key={selected.id}
                card={selected}
                resolveImage={resolveImage}
                onDuplicate={() => onDuplicate(selected.id)}
                onDelete={() => onDelete(selected.id)}
            />
        );
    }
    if (selected.kind === 'image') {
        return (
            <figure className="wiw-editor-card wiw-image-view">
                <h3 className="wiw-editor-title">{selected.name}</h3>
                {selected.source === '' ? (
                    <div className="wiw-editor-empty">
                        No image data yet (prototype placeholder).
                    </div>
                ) : (
                    <img src={selected.source} alt={selected.name} />
                )}
                <figcaption>{selected.caption}</figcaption>
                <div className="wiw-editor-actions">
                    <button type="button" className="wiw-button wiw-icon-button" title="Duplicate this image" onClick={() => onDuplicate(selected.id)}>
                        <i className="fa-solid fa-clone" />
                    </button>
                    <button type="button" className="wiw-button wiw-icon-button" title="Delete this image" onClick={() => onDelete(selected.id)}>
                        <i className="fa-solid fa-trash-can" />
                    </button>
                </div>
            </figure>
        );
    }
    if (selected.isWiRoot) {
        return <FolderSettingsView key={selected.id} folder={selected} onToggleWiRoot={onToggleWiRoot} />;
    }
    return (
        <PlainFolderView
            folder={selected}
            onToggleWiRoot={onToggleWiRoot}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
        />
    );
}
