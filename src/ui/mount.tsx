import { createRoot } from 'react-dom/client';
import { WorkspacePrototype } from './WorkspacePrototype';
import '../styles/prototype.scss';

export function mountWorkspacePrototype(container: HTMLElement): void {
    createRoot(container).render(<WorkspacePrototype />);
}
