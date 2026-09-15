# Contract — LLM Port

Pure interface in `src/core/assistant/ports.ts`; the only implementation over the app is
`src/adapters/llmClient.ts` (research R1, R2, R7, R11). Tests use `FakeLlm`.

```ts
export type ProfileApi = 'chat-completion' | 'text-completion';

export interface ProfileInfo {
    id: string;
    name: string;
    api: ProfileApi;
    model: string;          // profile model id ('' when the profile has none)
    streaming: boolean;     // resolved from the profile's preset (R2)
}

export type LlmAvailability =
    | { state: 'ready'; profiles: ProfileInfo[] }
    | { state: 'connection-manager-disabled' };

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmRequest {
    profileId: string;
    messages: LlmMessage[];
    maxTokens: number;
    signal: AbortSignal;
}

export type LlmEvent =
    | { type: 'started'; streaming: boolean }
    | { type: 'progress'; text: string; reasoning: string }   // accumulated values
    | { type: 'done'; text: string; reasoning: string }
    | { type: 'failed'; failure: AssistantFailure };

export interface LlmPort {
    availability(): LlmAvailability;
    /** Subscribes to profile list changes; returns unsubscribe. */
    onProfilesChanged(listener: () => void): () => void;
    /** Never throws; every outcome is an event. Exactly one terminal event. */
    run(request: LlmRequest, onEvent: (event: LlmEvent) => void): Promise<void>;
}
```

## Guarantees (verified by `tests/contract/llm-client.test.ts`)

1. `availability()` returns `connection-manager-disabled` when
   `extensionSettings.disabledExtensions` contains `connection-manager`, without calling
   `getSupportedProfiles` (which would throw).
2. Profiles: `getSupportedProfiles()` mapped; `api` from profile `mode` (`cc`/`tc`);
   `streaming` from `getPresetManager('openai'|'textgenerationwebui')
   .getCompletionPresetByName(preset)` (`stream_openai` / `streaming`), falling back to
   the current global setting when the preset is not found.
3. `run` calls `ConnectionManagerRequestService.sendRequest(profileId, messages,
   maxTokens, { stream, signal, extractData: true, includePreset: true, includeInstruct:
   true })` with **no** `overridePayload` in v1.
4. Streaming: iterates the generator; emits `progress` with the accumulated `text` and
   `state.reasoning` at most every 100 ms plus a final `done`. Non-streaming: one `done`
   from `{ content, reasoning }` (content coerced to string).
5. Errors: unwraps `error.cause`; classification per research R7 —
   `/429|rate.?limit|quota/i` → `rate-limit`; `AbortError` or `signal.aborted` →
   `aborted`; `TypeError: Failed to fetch` → `network`; `Profile not found` / unsupported
   API → `profile`; empty text → `empty`; other → `provider` with the message. `timeout`
   is raised by the port itself (no progress for 90 s streaming / 180 s non-streaming),
   aborting the underlying request.
6. The port never touches chat state, the main `abortController`, `GENERATION_*` events,
   or credentials.
7. Automatic retries are NOT done in the port; the conversation controller owns them
   (visible countdown, R7).
