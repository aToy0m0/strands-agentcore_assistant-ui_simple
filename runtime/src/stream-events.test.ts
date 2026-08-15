import type { AgentStreamEvent } from "@strands-agents/sdk";
import { describe, expect, it } from "vitest";
import { toSafeAgentOutput } from "./stream-events.js";

async function* stream(events: AgentStreamEvent[]) {
  yield* events;
}

describe("toSafeAgentOutput", () => {
  it("redacts Nova reasoning but reports answer progress", async () => {
    const events = stream([
      {
        type: "modelStreamUpdateEvent",
        event: {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "reasoningContentDelta", text: "private chain of thought" },
        },
      },
      {
        type: "modelStreamUpdateEvent",
        event: {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "textDelta", text: "回答です。" },
        },
      },
    ] as AgentStreamEvent[]);

    const output = [];
    for await (const event of toSafeAgentOutput(events, { model: "nova-2-lite", reasoning: { enabled: true, effort: "medium" } })) output.push(event);

    expect(output).toEqual([
      { type: "reasoning", text: "内容を考えています。\n" },
      { type: "reasoning-end" },
      { type: "reasoning", text: "回答を作成しています。\n" },
      { type: "text", text: "回答です。" },
    ]);
    expect(JSON.stringify(output)).not.toContain("private chain of thought");
  });

  it("converts any tool into generic tool events with its input and result", async () => {
    const events = stream([
      { type: "beforeToolCallEvent", toolUse: { name: "calculator", toolUseId: "tool-1", input: { secret: "hidden" } } },
      {
        type: "afterToolCallEvent",
        toolUse: { name: "calculator", toolUseId: "tool-1", input: {} },
        result: { toJSON: () => ({ toolResult: { content: [{ text: "sensitive result" }] } }) },
      },
    ] as AgentStreamEvent[]);

    const output = [];
    for await (const event of toSafeAgentOutput(events, { model: "nova-2-lite", reasoning: { enabled: true, effort: "medium" } })) output.push(event);

    expect(output).toEqual([
      { type: "tool-start", id: "tool-1", name: "calculator", input: { secret: "hidden" } },
      { type: "tool-result", id: "tool-1", result: [{ text: "sensitive result" }] },
    ]);
  });

  it("supports custom tool names without adding tool-specific UI definitions", async () => {
    const events = stream([
      { type: "beforeToolCallEvent", toolUse: { name: "unknown_tool", toolUseId: "tool-1", input: {} } },
    ] as AgentStreamEvent[]);

    const output = [];
    for await (const event of toSafeAgentOutput(events, { model: "glm-4-7", reasoning: { enabled: true } })) output.push(event);
    expect(output).toEqual([{ type: "tool-start", id: "tool-1", name: "unknown_tool", input: {} }]);
  });

  it("shows reasoning text for models whose content is available", async () => {
    const events = stream([{ type: "modelStreamUpdateEvent", event: { type: "modelContentBlockDeltaEvent", delta: { type: "reasoningContentDelta", text: "計算式を整理します。" } } }] as AgentStreamEvent[]);
    const output = [];
    for await (const event of toSafeAgentOutput(events, { model: "claude-haiku-4-5", reasoning: { enabled: true, effort: "medium" } })) output.push(event);
    expect(output).toEqual([
      { type: "reasoning", text: "計算式を整理します。" },
      { type: "reasoning-end" },
    ]);
  });

  it("preserves separate reasoning blocks", async () => {
    const events = stream([
      { type: "modelStreamUpdateEvent", event: { type: "modelContentBlockDeltaEvent", delta: { type: "reasoningContentDelta", text: "仮説を立てます。" } } },
      { type: "modelStreamUpdateEvent", event: { type: "modelContentBlockStopEvent" } },
      { type: "modelStreamUpdateEvent", event: { type: "modelContentBlockDeltaEvent", delta: { type: "reasoningContentDelta", text: "仮説を検証します。" } } },
      { type: "modelStreamUpdateEvent", event: { type: "modelContentBlockStopEvent" } },
    ] as AgentStreamEvent[]);
    const output = [];
    for await (const event of toSafeAgentOutput(events, { model: "claude-sonnet-4-6", reasoning: { enabled: true, effort: "medium" } })) output.push(event);
    expect(output).toEqual([
      { type: "reasoning", text: "仮説を立てます。" },
      { type: "reasoning-end" },
      { type: "reasoning", text: "仮説を検証します。" },
      { type: "reasoning-end" },
    ]);
  });
});
