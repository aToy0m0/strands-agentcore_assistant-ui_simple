import { EventType, RunAgentInputSchema, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import express, { type ErrorRequestHandler } from "express";

export type AgentOutputEvent =
  | { type: "reasoning"; text: string }
  | { type: "reasoning-end" }
  | { type: "tool-start"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; result: unknown; error?: string }
  | { type: "text"; text: string };

export type StreamAgent = (input: RunAgentInput, cancelSignal: AbortSignal) => AsyncIterable<AgentOutputEvent>;

export function promptFrom(input: RunAgentInput): string {
  const message = [...input.messages].reverse().find((item) => item.role === "user");
  if (!message) throw new Error("A user message is required");
  if (typeof message.content === "string") return message.content;
  const prompt = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
  if (!prompt) throw new Error("A text user message is required");
  return prompt;
}

export function createApp(streamAgent: StreamAgent) {
  const app = express();
  app.get("/ping", (_request, response) => response.json({ status: "Healthy" }));
  app.post("/invocations", express.json({ limit: "4mb" }), async (request, response) => {
    const parsed = RunAgentInputSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid AG-UI RunAgentInput", issues: parsed.error.issues });
    const input = parsed.data;
    const eventEncoder = new EventEncoder({ accept: request.headers.accept ?? "text/event-stream" });
    response.status(200);
    response.setHeader("Content-Type", eventEncoder.getContentType());
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    const send = (event: BaseEvent) => response.write(eventEncoder.encode(event));
    const cancellation = new AbortController();
    response.once("close", () => {
      if (!response.writableEnded) cancellation.abort();
    });
    let reasoningContextId: string | undefined;
    let reasoningMessageId: string | undefined;
    let textMessageId: string | undefined;
    const assistantMessageId = crypto.randomUUID();
    const closeReasoning = () => {
      if (!reasoningContextId || !reasoningMessageId) return;
      send({ type: EventType.REASONING_MESSAGE_END, messageId: reasoningMessageId });
      send({ type: EventType.REASONING_END, messageId: reasoningContextId });
      reasoningContextId = undefined;
      reasoningMessageId = undefined;
    };
    const closeText = () => {
      if (!textMessageId) return;
      send({ type: EventType.TEXT_MESSAGE_END, messageId: textMessageId });
      textMessageId = undefined;
    };
    try {
      send({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
      let hasText = false;

      for await (const event of streamAgent(input, cancellation.signal)) {
        if (response.destroyed || response.writableEnded) return;
        if (event.type === "reasoning-end") {
          closeReasoning();
          continue;
        }
        if (event.type === "reasoning") {
          if (!event.text) continue;
          closeText();
          if (!reasoningContextId || !reasoningMessageId) {
            reasoningContextId = crypto.randomUUID();
            reasoningMessageId = crypto.randomUUID();
            send({ type: EventType.REASONING_START, messageId: reasoningContextId });
            send({ type: EventType.REASONING_MESSAGE_START, messageId: reasoningMessageId, role: "reasoning" });
          }
          send({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningMessageId, delta: event.text });
          continue;
        }

        if (event.type === "tool-start") {
          closeReasoning();
          closeText();
          send({ type: EventType.TOOL_CALL_START, toolCallId: event.id, toolCallName: event.name, parentMessageId: assistantMessageId });
          send({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.id, delta: JSON.stringify(event.input) });
          send({ type: EventType.TOOL_CALL_END, toolCallId: event.id });
          continue;
        }

        if (event.type === "tool-result") {
          closeReasoning();
          closeText();
          send({
            type: EventType.TOOL_CALL_RESULT,
            messageId: crypto.randomUUID(),
            toolCallId: event.id,
            content: JSON.stringify({ result: event.result, ...(event.error ? { error: event.error } : {}) }),
            role: "tool",
          });
          continue;
        }

        closeReasoning();
        if (!textMessageId) {
          textMessageId = assistantMessageId;
          send({ type: EventType.TEXT_MESSAGE_START, messageId: textMessageId, role: "assistant" });
        }
        hasText = true;
        send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textMessageId, delta: event.text });
      }
      if (!hasText) throw new Error("Strands returned no assistant text");
      closeReasoning();
      closeText();
      send({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
      response.end();
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      closeReasoning();
      closeText();
      console.error("Agent invocation failed", error);
      send({ type: EventType.RUN_ERROR, message: "エージェントの実行に失敗しました", code: "AGENT_INVOCATION_FAILED" });
      response.end();
    }
  });
  const invalidJson: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof SyntaxError) return void response.status(400).json({ error: "Request body must be valid JSON" });
    next(error);
  };
  app.use(invalidJson);
  return app;
}
