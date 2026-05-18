import {
  ChatGPTProvider,
  ChatGPTSession,
  createDefaultStorage,
} from "@conduit/provider-chatgpt";

const storage = await createDefaultStorage();
const llm = new ChatGPTProvider({
  session: new ChatGPTSession({ storage }),
});

const result = await llm.generateText({
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(result.text);
