# Conduit

Conduit is a TypeScript workspace for calling the Codex backend with a developer's own ChatGPT Plus/Pro subscription. It includes a ChatGPT subscription-backed provider, OAuth/session storage, structured output helpers, observability events, and a Bun-based CLI.

## Packages

- `@conduit/core`: provider interface, structured output helpers, typed errors, events, and redaction.
- `@conduit/provider-chatgpt`: OAuth/session/storage plus Codex backend transport.
- `@conduit/cli`: `conduit login`, `status`, `ask`, `doctor`, and `logout`.

The CLI uses Codex-compatible naming for headless authentication:

```sh
conduit login --device-auth
```

`--device-code` is accepted as an alias. Device auth is currently guarded until the public Codex auth flow is confirmed; interactive `conduit login` is the implemented path.

## Development

```sh
bun install
bun run typecheck
bun test
```

No dev server is required for the default checks.

## Example

```ts
import {
  ChatGPTProvider,
  ChatGPTSession,
  createDefaultStorage,
} from "@conduit/provider-chatgpt";

const storage = await createDefaultStorage();
const llm = new ChatGPTProvider({
  session: new ChatGPTSession({ storage })
});

const result = await llm.generateText({
  messages: [{ role: "user", content: "Say hello" }]
});

console.log(result.text);
```
