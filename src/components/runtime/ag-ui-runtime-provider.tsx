import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechDictationAdapter,
  WebSpeechSynthesisAdapter,
  useAuiEvent,
  type ExternalStoreThreadData,
  type ThreadMessage,
} from "@assistant-ui/react";
import { useAgUiRuntime, type UseAgUiThreadListAdapter } from "@assistant-ui/react-ag-ui";
import { fetchAuthSession } from "aws-amplify/auth";
import { runtimeInvocationUrl, type RuntimeConfig } from "@/config";
import { DEFAULT_RUNTIME_OPTIONS } from "@/lib/default-runtime-options";
import { InferenceSettingsProvider } from "./inference-settings";
import { generatedThreadTitle } from "./in-memory-threads";
import { RunErrorAwareHttpAgent } from "./run-error-aware-http-agent";

type RegularThread = ExternalStoreThreadData<"regular">;
type ArchivedThread = ExternalStoreThreadData<"archived">;

async function accessToken(forceRefresh = false): Promise<string> {
  const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
  const value = session.tokens?.accessToken?.toString();
  if (!value) throw new Error("認証セッションがありません。再度ログインしてください。");
  return value;
}

function authenticatedFetch(threadId: string): typeof fetch {
  return async (input, init) => {
    const send = async (forceRefresh: boolean) => {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set("Authorization", `Bearer ${await accessToken(forceRefresh)}`);
      headers.set("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id", threadId);
      return fetch(input, { ...init, headers });
    };
    let response = await send(false);
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      response = await send(true);
    }
    return response;
  };
}

export function AgUiRuntimeProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [items, setItems] = useState<Array<RegularThread | ArchivedThread>>([]);
  const messagesByThread = useRef(new Map<string, readonly ThreadMessage[]>());
  const runtimeRef = useRef<ReturnType<typeof useAgUiRuntime> | null>(null);
  const regular = items.filter((item): item is RegularThread => item.status === "regular");
  const archived = items.filter((item): item is ArchivedThread => item.status === "archived");
  const replace = useCallback((id: string, update: Partial<RegularThread | ArchivedThread>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } as RegularThread | ArchivedThread : item)), []);
  const saveCurrentMessages = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("チャットRuntimeが初期化されていません");
    messagesByThread.current.set(threadId, [...runtime.thread.getState().messages]);
  }, [threadId]);
  const showCurrent = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("チャットRuntimeが初期化されていません");
    const title = generatedThreadTitle(runtime.thread.getState().messages) ?? "新しいチャット";
    setItems((current) => {
      const existing = current.find((item) => item.id === threadId);
      if (!existing) return [{ id: threadId, remoteId: threadId, title, status: "regular", custom: { started: true } }, ...current];
      return current.map((item) => item.id === threadId
        ? { ...item, title: item.title === "新しいチャット" ? title : item.title, custom: { ...item.custom, started: true } } as RegularThread | ArchivedThread
        : item);
    });
  }, [threadId]);

  const threadList = useMemo<UseAgUiThreadListAdapter>(() => ({
    threadId,
    threads: regular,
    archivedThreads: archived,
    onSwitchToNewThread: async () => { saveCurrentMessages(); setThreadId(crypto.randomUUID()); },
    onSwitchToThread: async (id) => {
      saveCurrentMessages();
      const messages = messagesByThread.current.get(id);
      if (!messages) throw new Error(`チャット履歴が見つかりません: ${id}`);
      setThreadId(id);
      return { messages };
    },
    onRename: async (id, title) => replace(id, { title }),
    onUpdateCustom: async (id, custom) => replace(id, { custom }),
    onArchive: async (id) => replace(id, { status: "archived" }),
    onUnarchive: async (id) => replace(id, { status: "regular" }),
    onDelete: async (id) => { messagesByThread.current.delete(id); setItems((current) => current.filter((item) => item.id !== id)); },
  }), [archived, regular, replace, saveCurrentMessages, threadId]);

  const agent = useMemo(() => new RunErrorAwareHttpAgent({ url: runtimeInvocationUrl(config), agentId: "workmate", threadId, headers: { Accept: "text/event-stream" }, fetch: authenticatedFetch(threadId) }), [config, threadId]);
  const attachments = useMemo(() => new CompositeAttachmentAdapter([new SimpleImageAttachmentAdapter(), new SimpleTextAttachmentAdapter()]), []);
  const runtime = useAgUiRuntime({
    agent,
    showThinking: true,
    onError: (cause) => window.dispatchEvent(new CustomEvent("workmate-error", { detail: cause.message })),
    adapters: {
      threadList,
      attachments,
      speech: useMemo(() => new WebSpeechSynthesisAdapter(), []),
      dictation: useMemo(() => WebSpeechDictationAdapter.isSupported() ? new WebSpeechDictationAdapter({ language: "ja-JP", continuous: true }) : undefined, []),
      feedback: { submit: ({ type }) => window.dispatchEvent(new CustomEvent("workmate-feedback", { detail: type })) },
    },
  });
  useEffect(() => {
    runtimeRef.current = runtime;
    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [runtime]);

  return <AssistantRuntimeProvider runtime={runtime}><InferenceSettingsProvider options={DEFAULT_RUNTIME_OPTIONS}><ThreadLifecycleSync onRunStart={showCurrent} /><Fragment key={threadId}>{children}</Fragment></InferenceSettingsProvider></AssistantRuntimeProvider>;
}

function ThreadLifecycleSync({ onRunStart }: { onRunStart: () => void }) {
  useAuiEvent("thread.runStart", onRunStart);
  return null;
}
