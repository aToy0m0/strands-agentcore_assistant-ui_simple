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

function entraContext() {
  return {
    cognitoDomainPrefix: "workmate12-entra-test",
    entraEnabled: true,
    entraTenantId: "00000000-0000-0000-0000-000000000001",
    entraClientId: "00000000-0000-0000-0000-000000000002",
    entraClientSecretName: "workmate12/entra/client-secret",
  };
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

  it("loginMethods=entraならApp Client側でもCognitoログインを塞ぐ", () => {
    const value = template({ ...entraContext(), loginMethods: "entra" });
    value.hasResourceProperties("AWS::Cognito::UserPoolClient", Match.objectLike({
      SupportedIdentityProviders: ["MicrosoftEntraID"],
      // 空にするとExplicitAuthFlowsが消えCognitoの既定（SRP等）が復活するため、明示が必要
      ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
    }));
  });

  it("loginMethods=cognitoならEntraをApp Clientから外す", () => {
    const value = template({ ...entraContext(), loginMethods: "cognito" });
    value.hasResourceProperties("AWS::Cognito::UserPoolClient", Match.objectLike({
      SupportedIdentityProviders: ["COGNITO"],
      ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    }));
  });

  it("両方表示なら両方を許可し、USER_PASSWORD_AUTHは許可しない", () => {
    const value = template({ ...entraContext(), loginMethods: "cognito-and-entra" });
    value.hasResourceProperties("AWS::Cognito::UserPoolClient", Match.objectLike({
      SupportedIdentityProviders: ["COGNITO", "MicrosoftEntraID"],
      ExplicitAuthFlows: Match.not(Match.arrayWith(["ALLOW_USER_PASSWORD_AUTH"])),
    }));
  });
});
