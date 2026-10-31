# Recorded Ollama transcripts

Real responses from a local `gemma3:4b`, captured so the prompt and the client can be
checked without a live model on every run. The suite never calls Ollama; these files are
data, and the tests that read them say which claim each one supports.

Treat the `response` body of every fixture as untrusted model text, the same way
`src/oracle.ts` does. Do not execute it, and do not paste it into a shell.

## Files

| File | Supports |
| --- | --- |
| `ollama-0.40.11-tools-400.json` | Why the judge agent has no tools (`src/judge.ts`). `gemma3:4b` answers a `tools` array with HTTP 400. |

## Capture environment

Ollama 0.40.11 on Windows, model `gemma3:4b`, CPU only (`num_gpu: 0`, the GPU failed to
initialize on that box). Ollama listens on its own loopback address and is not exposed to
the network, so the capture ran over SSH as a remote PowerShell call rather than a direct
HTTP request from another machine.

## Re-capturing

Point `OLLAMA_HOST` at a machine running the model and post the fixture's `request` object
to `/api/chat`, keeping the status code and the response body verbatim:

```bash
curl -sS -o body.json -w '%{http_code}\n' \
  -X POST "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/chat" \
  -H 'Content-Type: application/json' \
  --data-binary @request.json
```

Record the Ollama version (`ollama --version`) and the date in the fixture. A different
version or a different model can legitimately give a different answer; when that happens,
add a fixture rather than editing this one, so the old behavior stays readable.
