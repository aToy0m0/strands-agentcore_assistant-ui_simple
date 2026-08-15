import { describe, expect, it } from "vitest";
import { runtimeInvocationUrl, type RuntimeConfig } from "../src/config.js";

describe("runtimeInvocationUrl", () => {
  it("Runtime ARNをURLエンコードして直接呼び出しURLを作る", () => {
    const config = {
      agent: { runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example", qualifier: "DEFAULT" },
    } as RuntimeConfig;
    expect(runtimeInvocationUrl(config)).toBe("https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A123456789012%3Aruntime%2Fexample/invocations?qualifier=DEFAULT");
  });
});
