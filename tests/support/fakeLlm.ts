import type { LlmAvailability, LlmEvent, LlmPort, LlmRequest, ProfileInfo } from '../../src/core/assistant/ports';
import type { AssistantFailure } from '../../src/core/assistant/types';

type Script =
    | { kind: 'stream'; chunks: string[]; reasoning?: string; delayMs: number }
    | { kind: 'reply'; text: string; reasoning?: string }
    | { kind: 'fail'; failure: AssistantFailure }
    | { kind: 'hang' };

export const FAKE_PROFILE: ProfileInfo = {
    id: 'p-router',
    name: 'openrouter free provider',
    api: 'chat-completion',
    model: 'openrouter/free',
    streaming: true,
};

/**
 * Scripted LlmPort for controller tests: streams, plain replies, failures with a
 * bounded number of repeats, and a request that only ends on abort.
 */
export class FakeLlm implements LlmPort {
    profiles: ProfileInfo[] = [FAKE_PROFILE];
    state: 'ready' | 'connection-manager-disabled' = 'ready';
    readonly requests: LlmRequest[] = [];
    private queue: Script[] = [];
    private fallback: Script = { kind: 'reply', text: 'ok' };
    private readonly listeners = new Set<() => void>();

    availability(): LlmAvailability {
        return this.state === 'ready'
            ? { state: 'ready', profiles: [...this.profiles] }
            : { state: 'connection-manager-disabled' };
    }

    onProfilesChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emitProfilesChanged(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    /** Next run streams these chunks (each chunk is appended text). */
    stream(chunks: string[], options: { delayMs?: number; reasoning?: string } = {}): this {
        this.queue.push({
            kind: 'stream',
            chunks,
            reasoning: options.reasoning,
            delayMs: options.delayMs ?? 0,
        });
        return this;
    }

    reply(text: string, reasoning?: string): this {
        this.queue.push({ kind: 'reply', text, reasoning });
        return this;
    }

    fail(failure: AssistantFailure): this {
        this.queue.push({ kind: 'fail', failure });
        return this;
    }

    failTimes(times: number, failure: AssistantFailure): this {
        for (let i = 0; i < times; i += 1) {
            this.fail(failure);
        }
        return this;
    }

    hang(): this {
        this.queue.push({ kind: 'hang' });
        return this;
    }

    /** Used for every run once the queue is empty. */
    always(script: { text: string; reasoning?: string }): this {
        this.fallback = { kind: 'reply', text: script.text, reasoning: script.reasoning };
        return this;
    }

    async run(request: LlmRequest, onEvent: (event: LlmEvent) => void): Promise<void> {
        this.requests.push(request);
        const script = this.queue.shift() ?? this.fallback;
        if (script.kind === 'fail') {
            onEvent({ type: 'started', streaming: false });
            onEvent({ type: 'failed', failure: script.failure });
            return;
        }
        if (script.kind === 'hang') {
            onEvent({ type: 'started', streaming: false });
            await new Promise<void>((resolve) => {
                if (request.signal.aborted) {
                    resolve();
                    return;
                }
                request.signal.addEventListener('abort', () => resolve(), { once: true });
            });
            onEvent({
                type: 'failed',
                failure: { kind: 'aborted', message: 'The request was stopped.', retryable: true },
            });
            return;
        }
        if (script.kind === 'reply') {
            onEvent({ type: 'started', streaming: false });
            if (request.signal.aborted) {
                onEvent({
                    type: 'failed',
                    failure: { kind: 'aborted', message: 'The request was stopped.', retryable: true },
                });
                return;
            }
            onEvent({ type: 'done', text: script.text, reasoning: script.reasoning ?? '' });
            return;
        }
        onEvent({ type: 'started', streaming: true });
        let text = '';
        for (const chunk of script.chunks) {
            if (request.signal.aborted) {
                onEvent({
                    type: 'failed',
                    failure: { kind: 'aborted', message: 'The request was stopped.', retryable: true },
                });
                return;
            }
            text += chunk;
            onEvent({ type: 'progress', text, reasoning: script.reasoning ?? '' });
            if (script.delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, script.delayMs));
            }
        }
        if (request.signal.aborted) {
            onEvent({
                type: 'failed',
                failure: { kind: 'aborted', message: 'The request was stopped.', retryable: true },
            });
            return;
        }
        onEvent({ type: 'done', text, reasoning: script.reasoning ?? '' });
    }
}
