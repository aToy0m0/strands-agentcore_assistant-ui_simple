import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { WorkmateCodeZipStack } from "../infrastructure/stack.js";

function template(context: Record<string, unknown> = {}) {
  const app = new App({ context });
  return Template.fromStack(new WorkmateCodeZipStack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
  }));
}

describe("WorkmateCodeZipStack", () => {
  it("Cognito認証・静的Web・CodeZip Runtimeだけを構築する", () => {
    const value = template({ cognitoDomainPrefix: "workmate12-test" });
    value.resourceCountIs("AWS::Cognito::UserPool", 1);
    value.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    value.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    value.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 0);
    value.resourceCountIs("AWS::BedrockAgentCore::Runtime", 1);
    value.resourceCountIs("AWS::CloudFront::Distribution", 1);
    value.resourceCountIs("AWS::DynamoDB::Table", 0);
    value.resourceCountIs("AWS::RDS::DBInstance", 0);
    value.resourceCountIs("AWS::Lambda::Url", 0);
    value.hasResourceProperties("AWS::BedrockAgentCore::Runtime", Match.objectLike({
      ProtocolConfiguration: "AGUI",
      AgentRuntimeArtifact: { CodeConfiguration: Match.objectLike({ Runtime: "NODE_22", EntryPoint: ["dist/app.js"] }) },
      AuthorizerConfiguration: { CustomJWTAuthorizer: Match.objectLike({ AllowedClients: Match.anyValue() }) },
    }));
  });

  it("Entraオプション有効時だけOIDC IdPを追加する", () => {
    const value = template({
      cognitoDomainPrefix: "workmate12-entra-test",
      entraEnabled: true,
      entraTenantId: "00000000-0000-0000-0000-000000000001",
      entraClientId: "00000000-0000-0000-0000-000000000002",
      entraClientSecretName: "workmate12/entra/client-secret",
    });
    value.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 1);
    value.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
      ProviderName: "MicrosoftEntraID",
      ProviderType: "OIDC",
      ProviderDetails: Match.objectLike({
        authorize_scopes: "openid email",
        oidc_issuer: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000001/v2.0",
      }),
      AttributeMapping: { email: "email", username: "sub" },
    });
  });

  it("Entra必須入力が欠けていればsynthを拒否する", () => {
    expect(() => template({ entraEnabled: true })).toThrow("entraTenantId");
  });

  it("Entraを無効にしたままEntra表示を指定すればsynthを拒否する", () => {
    expect(() => template({ cognitoDomainPrefix: "workmate12-test", loginMethods: "entra" }))
      .toThrow("requires entraEnabled=true");
  });

  it("未知のloginMethodsはsynthを拒否する", () => {
    expect(() => template({ cognitoDomainPrefix: "workmate12-test", loginMethods: "saml" }))
      .toThrow("loginMethods must be one of");
  });

  it("loginMethodsが正しければsynthできる", () => {
    expect(() => template({
      cognitoDomainPrefix: "workmate12-entra-test",
      entraEnabled: true,
      entraTenantId: "00000000-0000-0000-0000-000000000001",
      entraClientId: "00000000-0000-0000-0000-000000000002",
      entraClientSecretName: "workmate12/entra/client-secret",
      loginMethods: "entra",
    })).not.toThrow();
  });
});
