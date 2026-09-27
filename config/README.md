# AI configuration

Copy `ai-config.example.json` to `ai-config.json`, then set provider API keys and enable the providers that should receive traffic.

`ai-config.json` is intentionally ignored by Git because it contains secrets. The API can update this file through the administrator AI configuration endpoints. API and worker processes reload it when the file changes.

The only AI-related environment variable is:

```env
AI_CONFIG_PATH=./config/ai-config.json
```

Provider ids are product-facing routing ids. Provider `type` selects the request adapter:

- `grsai`: GrsAI Nano Banana task API.
- `gemini-official`: Google Gemini `generateContent` API.
- `openai-images`: OpenAI Images-compatible generation and edit API.

The legacy provider id `gemini` is configured as an alias of `grsai` so existing queued jobs and history records remain readable.

Each Provider can also set `concurrency` and `rpm` in the management console. `concurrency` controls simultaneous image generations for that Provider; `rpm` limits generation starts per minute, and `0` means unlimited. Existing configurations without these fields default to a concurrency of `4` and unlimited RPM.

OpenAI-compatible providers can set `fallbackProviderIds` to try another provider after a request or output download fails. Set `fallbackOnly: true` on a backup provider to keep it out of the user-facing model list while still allowing failover. `imageQuality` and `imageResponseFormat` can pin a relay to `high` and URL responses when the relay has stricter defaults.

Fallback-only providers cannot be selected as either default route. During failover, the worker releases the previous provider's slot before acquiring the backup provider's own concurrency/RPM budget, then renews and releases that new slot with the job. Limits remain configurable; this does not reduce the existing configured capacity. Direct adapter callers must supply the worker execution context to use failover.
