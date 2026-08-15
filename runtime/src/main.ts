import { Agent } from "@strands-agents/sdk";
import { createApp, promptFrom } from "./app.js";
import { historyFrom } from "./history.js";
import { createBedrockModel } from "./model-factory.js";
import { WORKMATE_SYSTEM_PROMPT } from "./system-prompt.js";
import { utilityTools } from "./tools.js";
import { toSafeAgentOutput } from "./stream-events.js";
import { parseInferenceSelection } from "../../shared/model-catalog.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const region = required("AWS_REGION");

const app = createApp(async function* (input, cancelSignal) {
  const forwarded = typeof input.forwardedProps === "object" && input.forwardedProps !== null
    ? input.forwardedProps as Record<string, unknown>
    : {};
  const selection = parseInferenceSelection(forwarded.inference);
  const agent = new Agent({
    model: createBedrockModel(region, selection),
    systemPrompt: WORKMATE_SYSTEM_PROMPT,
    tools: utilityTools,
    messages: historyFrom(input),
    printer: false,
  });
  yield* toSafeAgentOutput(agent.stream(promptFrom(input), { cancelSignal }), selection);
});

app.listen(8080, "0.0.0.0", () => console.log("AgentCore Runtime listening on 0.0.0.0:8080"));
