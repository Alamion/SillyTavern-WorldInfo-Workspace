import { useSyncExternalStore } from 'react';
import type { AvailabilityService } from '../../adapters/availability';
import type { ImageGeneration } from '../../adapters/imageGeneration';
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
    commitPrompt(imageId: string, prompt: string): void;
}

export function ImageGenerationSection({ image, services }: { image: ImageNode; services: ImageAiServices }): JSX.Element {
    const generate = useFeature(services.availability, 'image-generate');
    const view = useSyncExternalStore(services.generation.subscribe, () => services.generation.view(image.id));
    const prompt = useDraftField(image.prompt ?? '', (next) => services.commitPrompt(image.id, next));
    const busy = view.running !== null;

    const start = (): void => {
        prompt.onBlur();
        void services.generation.generate(image.id, prompt.value);
    };

    return (
        <div className="wiw-image-ai">
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
