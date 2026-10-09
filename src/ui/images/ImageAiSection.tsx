import { useState, useSyncExternalStore } from 'react';
import type { AvailabilityService } from '../../adapters/availability';
import type { ImageCaption } from '../../adapters/imageCaption';
import type { ImageGeneration } from '../../adapters/imageGeneration';
import { confirmDialog } from '../../adapters/popups';
import type { ImageNode } from '../../core/state/schema';
import { FormField, GatedButton, useFeature } from '../formControls';
import { useDraftField } from '../useDraftField';

/**
 * AI actions of the image editor (spec 009 contracts/ui-contract.md): the prompt,
 * Generate with a candidate beside the current picture (Keep / Discard /
 * Generate again). The prompt is a field of the item: what is typed is kept.
 */

export interface ImageAiServices {
    availability: AvailabilityService;
    generation: ImageGeneration;
    caption: ImageCaption;
    commitPrompt(imageId: string, prompt: string): void;
    openSettings(): void;
}

export function ImageGenerationSection({ image, services }: { image: ImageNode; services: ImageAiServices }): JSX.Element {
    const generate = useFeature(services.availability, 'image-generate');
    const draftState = useFeature(services.availability, 'image-prompt');
    const view = useSyncExternalStore(services.generation.subscribe, () => services.generation.view(image.id));
    const draft = useSyncExternalStore(services.caption.subscribe, () => services.caption.draftView(image.id));
    const prompt = useDraftField(image.prompt ?? '', (next) => services.commitPrompt(image.id, next));
    const busy = view.running !== null;

    const start = (): void => {
        prompt.onBlur();
        void services.generation.generate(image.id, prompt.value);
    };

    const writePrompt = async (): Promise<void> => {
        const idea = prompt.value;
        if (idea.trim() !== '' && !(await confirmDialog('Replace the prompt text with a draft? The current text is used as guidance.'))) {
            return;
        }
        prompt.onBlur();
        const text = await services.caption.draftPrompt(image.id, idea);
        if (text !== null) {
            services.commitPrompt(image.id, text);
        }
    };

    return (
        <div className="wiw-image-ai">
            <div className="wiw-image-ai-head">
                <h4>Picture from a prompt</h4>
                <button
                    type="button"
                    className="wiw-button wiw-icon-button"
                    title="Image settings: caption and prompt-drafting profiles"
                    onClick={services.openSettings}
                >
                    <i className="fa-solid fa-gear" />
                </button>
            </div>
            <FormField label="Prompt">
                <textarea
                    className="wiw-image-prompt"
                    rows={3}
                    placeholder="What the picture should show — e.g. a mining town carved into a red cliff at dusk"
                    value={prompt.value}
                    onChange={(event) => prompt.onChange(event.target.value)}
                    onBlur={prompt.onBlur}
                />
            </FormField>
            <div className="wiw-editor-actions">
                {draft.running ? (
                    <>
                        <span className="wiw-hint">
                            <i className="fa-solid fa-spinner fa-spin" /> Writing a prompt…
                        </span>
                        <button type="button" className="wiw-button" onClick={() => services.caption.stopDraft(image.id)}>
                            <i className="fa-solid fa-stop" /> Stop
                        </button>
                    </>
                ) : (
                    <GatedButton
                        state={draftState}
                        disabled={busy}
                        title="Let a model write a prompt from the lore in this folder; you can edit it before generating"
                        onClick={() => void writePrompt()}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles" /> Write prompt
                    </GatedButton>
                )}
                {busy ? (
                    <>
                        <span className="wiw-hint">
                            <i className="fa-solid fa-spinner fa-spin" /> Generating…
                        </span>
                        <button type="button" className="wiw-button" onClick={() => services.generation.stop(image.id)}>
                            <i className="fa-solid fa-stop" /> Stop
                        </button>
                    </>
                ) : (
                    <GatedButton
                        state={generate}
                        disabled={prompt.value.trim() === ''}
                        title="Generate a picture with the Image Generation extension's settings"
                        onClick={start}
                    >
                        <i className="fa-solid fa-palette" /> Generate
                    </GatedButton>
                )}
            </div>
            {draft.basis !== null && (
                <p className="wiw-hint">
                    {draft.basis.length > 0
                        ? `Based on: ${draft.basis.map((item) => item.name).join(', ')}`
                        : 'No lore entries were found near this image; the draft uses its name and caption only.'}
                </p>
            )}
            {draft.error !== null && <p className="wiw-hint wiw-field-error">{draft.error}</p>}
            {view.error !== null && <p className="wiw-hint wiw-field-error">{view.error}</p>}
            {view.candidate !== null && (
                <div className="wiw-image-candidate">
                    <div className="wiw-image-pair">
                        <figure>
                            {image.src === '' ? (
                                <div className="wiw-editor-empty">No picture yet</div>
                            ) : (
                                <img src={image.src} alt="Current picture" />
                            )}
                            <figcaption className="wiw-hint">Current</figcaption>
                        </figure>
                        <figure>
                            <img src={view.candidate.url} alt="Generated picture" />
                            <figcaption className="wiw-hint">New</figcaption>
                        </figure>
                    </div>
                    <div className="wiw-editor-actions">
                        <button
                            type="button"
                            className="wiw-button wiw-button-active"
                            disabled={view.keeping}
                            onClick={() => void services.generation.keep(image.id)}
                        >
                            <i className={`fa-solid ${view.keeping ? 'fa-spinner fa-spin' : 'fa-check'}`} /> Keep
                        </button>
                        <button
                            type="button"
                            className="wiw-button"
                            disabled={view.keeping}
                            onClick={() => services.generation.discard(image.id)}
                        >
                            <i className="fa-solid fa-xmark" /> Discard
                        </button>
                        <button type="button" className="wiw-button" disabled={view.keeping || busy} onClick={start}>
                            <i className="fa-solid fa-rotate" /> Generate again
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** "Write caption" beside the caption field, and the proposal under it (US3). */
export function ImageCaptionTools({ image, services }: { image: ImageNode; services: ImageAiServices }): JSX.Element | null {
    const captionState = useFeature(services.availability, 'image-caption');
    const view = useSyncExternalStore(services.caption.subscribe, () => services.caption.captionView(image.id));
    const [edited, setEdited] = useState<string | null>(null);
    if (image.src.trim() === '') {
        return null;
    }
    const proposal = edited ?? view.proposal ?? '';
    return (
        <>
            <div className="wiw-field-actions">
                {view.running ? (
                    <>
                        <span className="wiw-hint">
                            <i className="fa-solid fa-spinner fa-spin" /> Writing a caption…
                        </span>
                        <button type="button" className="wiw-button" onClick={() => services.caption.stopCaption(image.id)}>
                            <i className="fa-solid fa-stop" /> Stop
                        </button>
                    </>
                ) : (
                    <GatedButton
                        state={captionState}
                        title="Let a vision-capable model describe this picture; you review it before it is stored"
                        onClick={() => {
                            setEdited(null);
                            void services.caption.writeCaption(image.id);
                        }}
                    >
                        <i className="fa-solid fa-closed-captioning" /> Write caption
                    </GatedButton>
                )}
            </div>
            {view.error !== null && <p className="wiw-hint wiw-field-error">{view.error}</p>}
            {view.proposal !== null && (
                <div className="wiw-caption-proposal">
                    <span className="wiw-field-label">Proposed caption</span>
                    <textarea rows={2} value={proposal} onChange={(event) => setEdited(event.target.value)} />
                    <div className="wiw-editor-actions">
                        <button
                            type="button"
                            className="wiw-button wiw-button-active"
                            disabled={proposal.trim() === ''}
                            onClick={() => {
                                services.caption.keepCaption(image.id, proposal);
                                setEdited(null);
                            }}
                        >
                            <i className="fa-solid fa-check" /> Keep
                        </button>
                        <button
                            type="button"
                            className="wiw-button"
                            onClick={() => {
                                services.caption.discardCaption(image.id);
                                setEdited(null);
                            }}
                        >
                            <i className="fa-solid fa-xmark" /> Discard
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
