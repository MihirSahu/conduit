# @conduit-llm/provider-chatgpt

ChatGPT subscription-backed Conduit provider with OAuth session storage and Codex backend transport.

## Install

```sh
npm install @conduit-llm/provider-chatgpt
```

## Usage

```ts
import {
  ChatGPTProvider,
  ChatGPTSession,
  createDefaultStorage,
} from "@conduit-llm/provider-chatgpt";

const storage = await createDefaultStorage();
const llm = new ChatGPTProvider({
  session: new ChatGPTSession({ storage }),
});

const result = await llm.generateText({
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(result.text);
```

Use `@conduit-llm/cli` to create the ChatGPT OAuth session before using the provider in a local script.

By default, `createDefaultStorage()` stores OAuth tokens in
`~/.config/conduit/auth.json` with private file permissions. To opt into system
keyring storage instead, set `CONDUIT_STORAGE=keyring` when logging in and when
running queries:

```sh
CONDUIT_STORAGE=keyring conduit login --device-auth
CONDUIT_STORAGE=keyring conduit ask "Say hello"
```

`CONDUIT_STORAGE=file` is also accepted to select the default file storage
explicitly.
