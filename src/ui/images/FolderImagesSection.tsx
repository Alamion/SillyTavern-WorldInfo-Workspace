import type { FeatureState } from '../../core/availability';
import { FormSection, GatedButton } from '../formControls';

/** Folder editor: "Caption all images without captions" (spec 009 US4). */
export function FolderImagesSection({
    count,
    state,
    onCaption,
}: {
    count: number;
    state: FeatureState;
    onCaption: () => void;
}): JSX.Element {
    return (
        <FormSection
            title="Images"
            hint={
                count === 0
                    ? 'No images without captions in this folder.'
                    : `${String(count)} image${count === 1 ? '' : 's'} without captions in this folder and its subfolders.`
            }
        >
            <div className="wiw-editor-actions">
                <GatedButton
                    state={state}
                    disabled={count === 0}
                    title={count === 0 ? 'No images without captions' : 'A vision-capable model writes them; you review before anything is stored'}
                    onClick={onCaption}
                >
                    <i className="fa-solid fa-closed-captioning" /> Caption all images without captions
                </GatedButton>
            </div>
        </FormSection>
    );
}
