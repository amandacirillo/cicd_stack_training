/**
 * Per-environment configuration for the training stack.
 *
 * IMPORTANT (training note): every VPC/subnet/hosted-zone/certificate value
 * below is a FAKE placeholder - it will not resolve to anything real. In a
 * real repo (see wilbur-template-editor/cdk/lib/config/environments.ts)
 * these would be actual AWS resource IDs for each of your accounts, and
 * this file is exactly the kind of thing you should double check isn't
 * accidentally committed with production secrets baked into it (it's fine
 * for resource IDs like VPC/subnet ids, NOT for credentials/API keys - use
 * Secrets Manager for those, see how LANGFUSE_SECRET_KEY-equivalent below
 * is handled in example_service_stack.ts).
 */
export interface BrokerConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
}

export interface TrainingStackConfig {
  environment: string;
  vpcId: string;
  privateSubnetIds: string[];
  certificateArn: string;
  managedPrefixList?: string;
  hostedZoneId: string;
  hostedZoneName: string;
  cpu: number;
  memory: number;
  desiredCount: number;
  // Optional: when set, the stack wires up ALB authenticate-oidc auth in
  // front of the app instead of leaving it open. Undefined = no auth layer
  // (fine for this training sandbox; do NOT ship that to a real prod env).
  broker?: BrokerConfig;
}

export const environments: Record<string, TrainingStackConfig> = {
  sandbox: {
    environment: 'sandbox',
    vpcId: 'vpc-EXAMPLE00SANDBOX1',
    managedPrefixList: 'pl-EXAMPLEINTRANET01',
    privateSubnetIds: ['subnet-EXAMPLESBXPRIV1', 'subnet-EXAMPLESBXPRIV2'],
    hostedZoneId: 'ZEXAMPLESANDBOXZONE',
    hostedZoneName: 'sandbox.example-internal.com',
    certificateArn: 'example-cert-id-sandbox-0000',
    cpu: 256,
    memory: 512,
    desiredCount: 1,
    // No broker config in sandbox - this env intentionally runs without an
    // auth layer so engineers can hit it directly while developing.
  },
  nonprod: {
    environment: 'nonprod',
    vpcId: 'vpc-EXAMPLE0NONPROD1',
    managedPrefixList: 'pl-EXAMPLEINTRANET01',
    privateSubnetIds: ['subnet-EXAMPLENPPRIV1', 'subnet-EXAMPLENPPRIV2'],
    hostedZoneId: 'ZEXAMPLENONPRODZONE',
    hostedZoneName: 'nonprod.example-internal.com',
    certificateArn: 'example-cert-id-nonprod-0000',
    cpu: 512,
    memory: 1024,
    desiredCount: 1,
    broker: {
      issuer: 'https://auth-nonprod.example-internal.com/broker',
      authorizationEndpoint: 'https://auth-nonprod.example-internal.com/broker/authorize',
      tokenEndpoint: 'https://auth-broker-internal-nonprod.example-internal.com/broker/token',
      userInfoEndpoint: 'https://auth-broker-internal-nonprod.example-internal.com/broker/userinfo',
    },
  },
  prod: {
    environment: 'prod',
    vpcId: 'vpc-EXAMPLE000PROD1',
    managedPrefixList: 'pl-EXAMPLEINTRANET01',
    privateSubnetIds: ['subnet-EXAMPLEPRODPRIV1', 'subnet-EXAMPLEPRODPRIV2'],
    hostedZoneId: 'ZEXAMPLEPRODZONE000',
    hostedZoneName: 'prod.example-internal.com',
    certificateArn: 'example-cert-id-prod-00000',
    cpu: 512,
    memory: 1024,
    desiredCount: 2,
    broker: {
      issuer: 'https://auth-prod.example-internal.com/broker',
      authorizationEndpoint: 'https://auth-prod.example-internal.com/broker/authorize',
      tokenEndpoint: 'https://auth-broker-internal-prod.example-internal.com/broker/token',
      userInfoEndpoint: 'https://auth-broker-internal-prod.example-internal.com/broker/userinfo',
    },
  },
};
