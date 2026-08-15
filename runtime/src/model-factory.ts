import { BedrockModel, type BedrockModelOptions } from "@strands-agents/sdk";
import { modelByKey, type InferenceSelection, type ReasoningEffort } from "../../shared/model-catalog.js";

const CLAUDE_BUDGET: Record<ReasoningEffort, number> = {
  low: 1_024,
  medium: 4_096,
  high: 8_192,
};

function requiredEffort(selection: InferenceSelection): ReasoningEffort {
  if (!selection.reasoning.enabled || !selection.reasoning.effort) throw new Error(`${selection.model} requires reasoning effort`);
  return selection.reasoning.effort;
}

export function bedrockModelOptions(region: string, selection: InferenceSelection): BedrockModelOptions {
  const model = modelByKey(selection.model);
  const common: BedrockModelOptions = { region, modelId: model.modelId, stream: true };

  switch (model.requestAdapter) {
    case "nova-reasoning":
      return {
        ...common,
        additionalRequestFields: selection.reasoning.enabled
          ? { reasoningConfig: { type: "enabled", maxReasoningEffort: requiredEffort(selection) } }
          : { reasoningConfig: { type: "disabled" } },
      };
    case "claude-budget":
      return selection.reasoning.enabled
        ? { ...common, maxTokens: 16_000, additionalRequestFields: { thinking: { type: "enabled", budget_tokens: CLAUDE_BUDGET[requiredEffort(selection)] } } }
        : { ...common, maxTokens: 16_000 };
    case "claude-adaptive":
      return selection.reasoning.enabled
        ? { ...common, maxTokens: 16_000, additionalRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: requiredEffort(selection) } } }
        : { ...common, maxTokens: 16_000 };
    case "claude-always-on":
      return { ...common, maxTokens: 16_000, additionalRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: selection.reasoning.enabled ? requiredEffort(selection) : "low" } } };
    case "gpt-oss-reasoning":
      return { ...common, maxTokens: 16_000, additionalRequestFields: { reasoning_effort: selection.reasoning.enabled ? requiredEffort(selection) : "low" } };
    case "glm-thinking":
      return { ...common, maxTokens: 4_096, additionalRequestFields: { thinking: { type: selection.reasoning.enabled ? "enabled" : "disabled" } } };
  }
}

export function createBedrockModel(region: string, selection: InferenceSelection): BedrockModel {
  return new BedrockModel(bedrockModelOptions(region, selection));
}
