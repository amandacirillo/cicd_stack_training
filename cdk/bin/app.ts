import * as cdk from 'aws-cdk-lib';
import { ExampleServiceStack } from '../lib/example_service_stack';
import { environments } from '../lib/config/environments';

const app = new cdk.App();

// `--context environment=<name>` selects which environment's config to use
// (see .gitlab-ci.yml: each deploy job passes its own environment name).
const environmentName = app.node.tryGetContext('environment') || 'sandbox';
const config = environments[environmentName];
if (!config) {
  throw new Error(`Unknown environment: ${environmentName}. Valid options: ${Object.keys(environments).join(', ')}`);
}

new ExampleServiceStack(app, `ExampleServiceStack-${environmentName}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
