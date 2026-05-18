# Conduit Product Requirements

Status: Draft  
Author: Mihir Sahu  
Last updated: 2026-05-11  
Version: 0.1  
Scope: Personal use

Conduit is a TypeScript library for making local application LLM calls through a developer's own ChatGPT Plus/Pro subscription via the Codex backend.

## Goals

- Provide a single `LLMProvider` interface across all providers.
- Ship a ChatGPT subscription provider with OAuth, refresh, storage, request transformation, and streaming.
- Support Zod-backed structured output and provider-specific schema sanitization.
- Support Node 20+, Bun 1+, and Deno via npm specifiers for library packages.
- Ship a Bun-based CLI for login, status, ask, doctor, and logout workflows.
- Use `conduit login --device-auth` as the Codex-compatible headless auth flag; keep `--device-code` as an alias for standard OAuth terminology.

## Non-goals

- Multi-user, hosted, or proxy operation.
- Multi-account rotation.
- Browser-side token handling.
- Anti-detection or adversarial backend behavior.
- First-class image, audio, or video modalities in v1.

## Target Layout

```text
packages/core
packages/provider-chatgpt
packages/cli
examples/node-script
```

The full source PRD for this bootstrap came from `.context/attachments/pasted_text_2026-05-11_12-30-51.txt`.
