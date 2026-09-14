import { createRoot } from 'react-dom/client';
import type { WorkspaceStateServices } from '../adapters/settingsStore';
import '../styles/prototype.scss';
import { WorkspaceApp } from './WorkspaceApp';

export function mountWorkspaceSurface(
    container: HTMLElement,
    services: WorkspaceStateServices
): void {
    createRoot(container).render(<WorkspaceApp services={services} />);
}