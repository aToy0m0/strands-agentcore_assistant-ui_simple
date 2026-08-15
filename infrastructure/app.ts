import { App } from "aws-cdk-lib";
import { WorkmateCodeZipStack } from "./stack.js";

const app = new App({ analyticsReporting: false });
new WorkmateCodeZipStack(app, "WorkmateCodeZipStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
