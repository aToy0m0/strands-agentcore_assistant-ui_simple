@{
  Profile              = "default"
  Region               = "us-east-1"
  WebDebugMode         = "off"
  CognitoDomainPrefix  = "<unique-domain-prefix>"
  KnowledgeBaseId     = "<bedrock-knowledge-base-id>"
  EntraEnabled         = $true
  EntraTenantId        = "<entra-tenant-id>"
  EntraClientId        = "<entra-application-client-id>"
  EntraClientSecretName = "<secrets-manager-secret-name>"
  LoginMethods         = "cognito-and-entra"
  LogRetentionDays     = 30
  RuntimeLogRequest    = "on"
  RuntimeLogModel      = "on"
  RuntimeLogTool       = "on"
}
