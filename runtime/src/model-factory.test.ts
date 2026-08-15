import { describe, expect, it } from "vitest";
import { bedrockModelOptions } from "./model-factory.js";

const region = "us-east-1";

describe("bedrockModelOptions", () => {
  it("enables Nova reasoning with the selected effort", () => {
    expect(bedrockModelOptions(region, { model: "nova-2-lite", reasoning: { enabled: true, effort: "medium" } })).toMatchObject({
      modelId: "us.amazon.nova-2-lite-v1:0",
      additionalRequestFields: { reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" } },
    });
  });

  it("disables Nova reasoning explicitly", () => {
    expect(bedrockModelOptions(region, { model: "nova-2-lite", reasoning: { enabled: false } })).toMatchObject({
      additionalRequestFields: { reasoningConfig: { type: "disabled" } },
    });
  });

  it("maps Claude budget and adaptive reasoning", () => {
    expect(bedrockModelOptions(region, { model: "claude-haiku-4-5", reasoning: { enabled: true, effort: "low" } }).additionalRequestFields)
      .toEqual({ thinking: { type: "enabled", budget_tokens: 1_024 } });
    expect(bedrockModelOptions(region, { model: "claude-sonnet-4-6", reasoning: { enabled: true, effort: "high" } }).additionalRequestFields)
      .toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  });

  it("maps always-on Claude and GPT-OSS effort", () => {
    expect(bedrockModelOptions(region, { model: "claude-sonnet-5", reasoning: { enabled: true, effort: "medium" } }).additionalRequestFields)
      .toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(bedrockModelOptions(region, { model: "gpt-oss-120b", reasoning: { enabled: true, effort: "high" } }).additionalRequestFields)
      .toEqual({ reasoning_effort: "high" });
  });

  it("maps the off preference to the minimum effort for always-on models", () => {
    expect(bedrockModelOptions(region, { model: "claude-sonnet-5", reasoning: { enabled: false } }).additionalRequestFields)
      .toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    expect(bedrockModelOptions(region, { model: "gpt-oss-20b", reasoning: { enabled: false } }).additionalRequestFields)
      .toEqual({ reasoning_effort: "low" });
  });

  it("maps GLM thinking without an effort field", () => {
    expect(bedrockModelOptions(region, { model: "glm-4-7-flash", reasoning: { enabled: true } }).additionalRequestFields)
      .toEqual({ thinking: { type: "enabled" } });
    expect(bedrockModelOptions(region, { model: "glm-4-7", reasoning: { enabled: false } }).additionalRequestFields)
      .toEqual({ thinking: { type: "disabled" } });
  });
});
