# @conduit-llm/cli

Bun-based CLI for ChatGPT subscription-backed Conduit login, status, and prompts.

## Install

```sh
npm install -g @conduit-llm/cli
```

The CLI entrypoint uses `#!/usr/bin/env bun`, so Bun must be installed and available on `PATH`.

## Usage

```sh
conduit login
conduit status
conduit ask "Say hello"
conduit ask --model gpt-5.4-mini "Say hello"
```

Headless login is available with Codex-compatible flags:

```sh
conduit login --device-auth
```

`--device-code` is accepted as an alias.
