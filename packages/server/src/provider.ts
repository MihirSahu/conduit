import { EventBus } from "@conduit-llm/core";
import {
  ChatGPTProvider,
  ChatGPTSession,
  FileTokenStorage,
  createDefaultStorage,
} from "@conduit-llm/provider-chatgpt";

export interface CreateProviderOptions {
  authPath?: string | undefined;
  model?: string | undefined;
}

export async function createServerProvider(
  options: CreateProviderOptions = {},
): Promise<ChatGPTProvider> {
  const storage = options.authPath
    ? new FileTokenStorage(options.authPath)
    : await createDefaultStorage();
  return new ChatGPTProvider({
    session: new ChatGPTSession({ storage, eventBus: new EventBus() }),
    ...(options.model ? { model: options.model } : {}),
  });
}
