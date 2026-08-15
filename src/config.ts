import { Amplify } from "aws-amplify";

export type RuntimeConfig = {
  environment: string;
  auth: {
    region: string;
    userPoolId: string;
    userPoolClientId: string;
    cognitoDomain: string;
    entraEnabled: boolean;
    entraProviderName: string | null;
  };
  agent: { runtimeArn: string; qualifier: string };
};

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`runtime-config.jsonの取得に失敗しました (${response.status})`);
  const value = await response.json() as RuntimeConfig;
  required(value.auth?.region, "auth.region");
  required(value.auth?.userPoolId, "auth.userPoolId");
  required(value.auth?.userPoolClientId, "auth.userPoolClientId");
  required(value.auth?.cognitoDomain, "auth.cognitoDomain");
  required(value.agent?.runtimeArn, "agent.runtimeArn");
  required(value.agent?.qualifier, "agent.qualifier");
  if (typeof value.auth.entraEnabled !== "boolean") throw new Error("auth.entraEnabled must be a boolean");
  if (value.auth.entraEnabled && !value.auth.entraProviderName) throw new Error("auth.entraProviderName is required when Entra is enabled");
  return value;
}

export function configureAmplify(config: RuntimeConfig) {
  const redirectUrl = `${window.location.origin}/`;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.auth.userPoolId,
        userPoolClientId: config.auth.userPoolClientId,
        loginWith: {
          email: true,
          oauth: {
            domain: config.auth.cognitoDomain,
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [redirectUrl],
            redirectSignOut: [redirectUrl],
            responseType: "code",
          },
        },
      },
    },
  });
}

export function runtimeInvocationUrl(config: RuntimeConfig): string {
  const region = config.agent.runtimeArn.split(":")[3];
  if (!region) throw new Error("AgentCore Runtime ARNからリージョンを取得できません");
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(config.agent.runtimeArn)}/invocations?qualifier=${encodeURIComponent(config.agent.qualifier)}`;
}
