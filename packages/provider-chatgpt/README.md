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
