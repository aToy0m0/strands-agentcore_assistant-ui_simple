import { EventType, type RunAgentInput } from "@ag-ui/core";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const input = {
  threadId: "0198d773-8f67-7678-baba-668a48c4d76f",
  runId: "0198d773-8f67-7678-baba-668a48c4d770",
  state: {},
  messages: [
    {
      id: "0198d773-8f67-7678-baba-668a48c4d771",
      role: "user",
      content: "1 + 2 は？",
    },
  ],
  tools: [],
  context: [],
  forwardedProps: { inference: { model: "nova-2-lite", reasoning: { enabled: true, effort: "medium" } } },
};

function eventsFrom(text: string): Array<Record<string, unknown>> {
  return text.split(/\r?\n/u)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("AgentCore HTTP contract", () => {
  it("returns the ping response", async () => {
    await request(createApp(vi.fn())).get("/ping").expect(200, { status: "Healthy" });
  });

  it("rejects invalid AG-UI input before invoking the agent", async () => {
    const invokeAgent = vi.fn();
    await request(createApp(invokeAgent)).post("/invocations").send({}).expect(400);
    expect(invokeAgent).not.toHaveBeenCalled();
  });

  it("streams the AG-UI lifecycle", async () => {
    const invokeAgent = vi.fn(async function* (_input: RunAgentInput, _cancelSignal: AbortSignal) {
      void _input;
      void _cancelSignal;
      yield { type: "reasoning" as const, text: "計算方法を確認しています。\n" };
      yield { type: "reasoning-end" as const };
      yield { type: "text" as const, text: "3" };
      yield { type: "text" as const, text: "です。" };
    });
    const response = await request(createApp(invokeAgent))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    expect(invokeAgent).toHaveBeenCalledOnce();
    expect(invokeAgent.mock.calls[0]?.[0]).toMatchObject(input);
    expect(invokeAgent.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(response.text).toContain(EventType.RUN_STARTED);
    expect(response.text).toContain(EventType.REASONING_START);
    expect(response.text).toContain(EventType.REASONING_MESSAGE_START);
    expect(response.text).toContain(EventType.REASONING_MESSAGE_CONTENT);
    expect(response.text).toContain(EventType.REASONING_MESSAGE_END);
    expect(response.text).toContain(EventType.REASONING_END);
    expect(response.text).toContain(EventType.TEXT_MESSAGE_CONTENT);
    expect(response.text.indexOf(EventType.REASONING_END)).toBeLessThan(response.text.indexOf(EventType.TEXT_MESSAGE_START));
    expect(response.text).toContain('"delta":"3"');
    expect(response.text).toContain('"delta":"です。"');
    expect(response.text).toContain(EventType.RUN_FINISHED);
  });

  it("returns RUN_ERROR in the stream when agent invocation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(async function* () {
      throw new Error("Bedrock unavailable: secret model details");
    }))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200);

    expect(response.text).toContain(EventType.RUN_ERROR);
    expect(response.text).toContain("AGENT_INVOCATION_FAILED");
    expect(response.text).toContain("エージェントの実行に失敗しました");
    expect(response.text).not.toContain("secret model details");
    consoleError.mockRestore();
  });

  it("closes an open reasoning message before RUN_ERROR", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(async function* () {
      yield { type: "reasoning" as const, text: "確認しています。\n" };
      throw new Error("Bedrock unavailable");
    }))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200);

    expect(response.text).toContain(EventType.REASONING_MESSAGE_END);
    expect(response.text).toContain(EventType.REASONING_END);
    expect(response.text.indexOf(EventType.REASONING_END)).toBeLessThan(response.text.indexOf(EventType.RUN_ERROR));
    consoleError.mockRestore();
  });

  it("pairs and uniquely identifies alternating reasoning and text sections", async () => {
    const response = await request(createApp(async function* () {
      yield { type: "reasoning" as const, text: "確認1\n" };
      yield { type: "text" as const, text: "回答1" };
      yield { type: "reasoning" as const, text: "確認2\n" };
      yield { type: "text" as const, text: "回答2" };
    }))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200);

    const events = eventsFrom(response.text);
    const count = (type: EventType) => events.filter((event) => event.type === type).length;
    expect(count(EventType.REASONING_START)).toBe(2);
    expect(count(EventType.REASONING_END)).toBe(2);
    expect(count(EventType.TEXT_MESSAGE_START)).toBe(2);
    expect(count(EventType.TEXT_MESSAGE_END)).toBe(2);
    const reasoningIds = events
      .filter((event) => event.type === EventType.REASONING_START
        || event.type === EventType.REASONING_MESSAGE_START)
      .map((event) => event.messageId);
    expect(new Set(reasoningIds).size).toBe(reasoningIds.length);
    const textIds = events.filter((event) => event.type === EventType.TEXT_MESSAGE_START).map((event) => event.messageId);
    expect(new Set(textIds).size).toBe(1);
  });

  it("emits separate AG-UI reasoning messages for consecutive reasoning blocks", async () => {
    const response = await request(createApp(async function* () {
      yield { type: "reasoning" as const, text: "仮説を立てます。" };
      yield { type: "reasoning-end" as const };
      yield { type: "reasoning" as const, text: "仮説を検証します。" };
      yield { type: "reasoning-end" as const };
      yield { type: "text" as const, text: "結論です。" };
    }))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200);

    const events = eventsFrom(response.text);
    expect(events.filter((event) => event.type === EventType.REASONING_START)).toHaveLength(2);
    expect(events.filter((event) => event.type === EventType.REASONING_MESSAGE_START)).toHaveLength(2);
    expect(events.filter((event) => event.type === EventType.REASONING_END)).toHaveLength(2);
  });

  it("links tool calls and the final text to one assistant message", async () => {
    const response = await request(createApp(async function* () {
      yield { type: "tool-start" as const, id: "tool-1", name: "calculator", input: { expression: "1+2" } };
      yield { type: "tool-result" as const, id: "tool-1", result: { value: 3 } };
      yield { type: "text" as const, text: "3です。" };
    }))
      .post("/invocations")
      .set("Accept", "text/event-stream")
      .send(input)
      .expect(200);

    const events = eventsFrom(response.text);
    const start = events.find((event) => event.type === EventType.TOOL_CALL_START);
    const text = events.find((event) => event.type === EventType.TEXT_MESSAGE_START);
    expect(start?.parentMessageId).toBe(text?.messageId);
    expect(events.find((event) => event.type === EventType.TOOL_CALL_ARGS)?.delta).toBe('{"expression":"1+2"}');
    expect(events.find((event) => event.type === EventType.TOOL_CALL_RESULT)?.content).toBe('{"result":{"value":3}}');
  });
});
