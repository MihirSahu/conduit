# @conduit-llm/core

Core TypeScript interfaces and utilities for Conduit providers.

## Install

```sh
npm install @conduit-llm/core
```

## Contents

- Provider request and response types.
- Typed auth, rate-limit, and provider errors.
- Structured output helpers.
- Event and redaction utilities.

## Usage

```ts
import { ProviderUnavailableError, redact } from "@conduit-llm/core";

const safe = redact({ accessToken: "secret" });
const error = new ProviderUnavailableError("Provider unavailable.");
```
