/**
 * Cancellation for long disk operations (spec 006 FR-003).
 *
 * FR-003 requires a long operation to report progress AND be cancellable, or be
 * declared uninterruptible before it starts. Only the READ phases qualify as
 * cancellable: a scan has written nothing, so stopping it leaves no trace.
 * Phases that write — export to disk, applying a pull, a native book push — are
 * deliberately NOT cancellable, because stopping halfway would leave a partially
 * written folder or book. Those are declared instead.
 */

export class OperationCancelled extends Error {
    constructor(message = 'Operation cancelled.') {
        super(message);
        this.name = 'OperationCancelled';
    }
}

export interface CancelToken {
    /** True once cancellation has been requested. */
    readonly cancelled: boolean;
    /** Throws `OperationCancelled` when cancellation has been requested. */
    throwIfCancelled(): void;
}

export interface CancelSource {
    token: CancelToken;
    cancel(): void;
}

export function createCancelSource(): CancelSource {
    let cancelled = false;
    return {
        token: {
            get cancelled(): boolean {
                return cancelled;
            },
            throwIfCancelled(): void {
                if (cancelled) {
                    throw new OperationCancelled();
                }
            },
        },
        cancel: (): void => {
            cancelled = true;
        },
    };
}

export function isCancellation(error: unknown): boolean {
    return error instanceof OperationCancelled;
}
