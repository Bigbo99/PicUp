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
