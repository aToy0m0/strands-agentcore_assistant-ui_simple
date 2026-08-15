import { DEFAULT_INFERENCE_SELECTION, MODEL_CATALOG } from "../../shared/model-catalog";
import type { RuntimeOptions } from "./runtime-options";

export const DEFAULT_RUNTIME_OPTIONS: RuntimeOptions = {
  defaultSelection: {
    model: DEFAULT_INFERENCE_SELECTION.model,
    reasoning: { enabled: true, effort: "medium" },
  },
  verifiedAt: "2026-08-15T00:00:00.000Z",
  pricingBasis: "us-east-1のオンデマンド標準料金（2026-08-15確認）",
  models: MODEL_CATALOG.map((model) => ({
    id: model.key,
    label: model.label,
    provider: model.provider,
    pricing: model.pricing,
    reasoning: model.reasoning,
  })),
};
