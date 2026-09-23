import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import {
  ApplicationProtocol,
  ListenerAction,
  ListenerCondition,
  UnauthenticatedAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { TrainingStackConfig } from './config/environments';

export interface ExampleServiceStackProps extends cdk.StackProps {
  config: TrainingStackConfig;
}

/**
 * A training-sized copy of the ECS Fargate + ALB + Route53 pattern used by
 * wilbur-template-editor. Every AWS resource ID referenced through `config`
 * is a placeholder (see cdk/lib/config/environments.ts) - this stack is meant
 * to be read and `cdk synth`'d to inspect the generated CloudFormation, not
 * necessarily deployed as-is (you'd need real VPC/subnet/hosted-zone/cert
 * IDs in your own AWS account first).
 */
export class ExampleServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExampleServiceStackProps) {
    super(scope, id, props);

    const { config } = props;

    // --- Values supplied at deploy time by the pipeline (see .gitlab-ci.yml)
    // instead of being hardcoded, so the same CDK code deploys a
    // pipeline-built image tag without ever needing a code change. ---
    const ecrRepositoryName = this.node.tryGetContext('ecrRepositoryName');
    const imageTag = this.node.tryGetContext('imageTag') ?? 'latest';
    const arnPrefix = this.node.tryGetContext('arnPrefix'); // e.g. arn:aws:acm:us-east-1:111111111111

    const domainName = `example-service.${config.hostedZoneName}`;

    /* -------------------- Networking -------------------- */
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId });
    const privateSubnets = config.privateSubnetIds.map((subnetId, i) =>
      ec2.Subnet.fromSubnetId(this, `PrivateSubnet${i}`, subnetId),
    );

    /* -------------------- ECS Cluster + ECR -------------------- */
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `example-service-${config.environment}`,
    });

    const repo = ecr.Repository.fromRepositoryName(this, 'EcrRepo', ecrRepositoryName);

    // ECR lifecycle policy: without this, every pipeline run pushes a new
    // image and the repo grows forever. Untagged (dangling) images expire
    // quickly; the last 20 tagged images are kept so you can roll back.
    const lifecyclePolicyText = JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: 'Expire untagged images after 7 days',
          selection: { tagStatus: 'untagged', countType: 'sinceImagePushed', countUnit: 'days', countNumber: 7 },
          action: { type: 'expire' },
        },
        {
          rulePriority: 2,
          description: 'Keep only the last 20 tagged images',
          selection: {
            tagStatus: 'tagged',
            tagPrefixList: ['sandbox', 'nonprod', 'prod', 'latest'],
            countType: 'imageCountMoreThan',
            countNumber: 20,
          },
          action: { type: 'expire' },
        },
      ],
    });
    new cr.AwsCustomResource(this, 'EcrLifecyclePolicy', {
      onCreate: {
        service: 'ECR',
        action: 'putLifecyclePolicy',
        parameters: { repositoryName: ecrRepositoryName, lifecyclePolicyText },
        physicalResourceId: cr.PhysicalResourceId.of(`${ecrRepositoryName}-lifecycle`),
      },
      onUpdate: {
        service: 'ECR',
        action: 'putLifecyclePolicy',
        parameters: { repositoryName: ecrRepositoryName, lifecyclePolicyText },
        physicalResourceId: cr.PhysicalResourceId.of(`${ecrRepositoryName}-lifecycle`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });

    /* -------------------- Task Definition -------------------- */
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: config.cpu,
      memoryLimitMiB: config.memory,
      taskRole,
    });

    // A real 3rd-party credential goes in Secrets Manager, never a plaintext
    // task-definition env var (that's readable by anyone with
    // ecs:DescribeTaskDefinition access). The pipeline still supplies the raw
    // value at deploy time as a masked CI/CD variable; CDK writes it into
    // Secrets Manager here, and ecs.Secret.fromSecretsManager() grants the
    // execution role read access automatically.
    const exampleApiKeySecret = new secretsmanager.Secret(this, 'ExampleApiKey', {
      secretName: `example-service/${config.environment}/example-api-key`,
      secretStringValue: cdk.SecretValue.unsafePlainText(process.env.EXAMPLE_API_KEY ?? 'placeholder-for-local-synth'),
    });

    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, imageTag),
      environment: {
        ENVIRONMENT: config.environment,
      },
      secrets: {
        EXAMPLE_API_KEY: ecs.Secret.fromSecretsManager(exampleApiKeySecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'example-service',
        // Explicit log group + retention: the awsLogs default (no retention
        // set) keeps logs forever - unbounded cost/compliance liability for
        // a service logging every request indefinitely.
        logGroup: new logs.LogGroup(this, 'AppLogGroup', {
          logGroupName: `/ecs/example-service-${config.environment}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });

    container.addPortMappings({ containerPort: 8000, protocol: ecs.Protocol.TCP });

    /* -------------------- ALB + Fargate Service -------------------- */
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: config.hostedZoneName,
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      `${arnPrefix}:certificate/${config.certificateArn}`,
    );

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: config.desiredCount,
      publicLoadBalancer: true,
      listenerPort: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificate,
      openListener: false,
      taskSubnets: { subnets: privateSubnets },
      assignPublicIp: false,
    });

    // Explicit health check path: the default "/" happening to return 200
    // conflates "a web server answered" with "the app is actually healthy".
    fargateService.targetGroup.configureHealthCheck({ path: '/health' });

    // --- Optional OIDC auth in front of the app ---
    // Undefined config.broker = plain forward action, no auth (fine for
    // sandbox/training). Once populated, this redirects unauthenticated
    // users to an OIDC provider before forwarding to the target group.
    if (config.broker) {
      const brokerClientSecret = new secretsmanager.Secret(this, 'BrokerClientSecret', {
        secretName: `example-service/${config.environment}/broker-client-secret`,
        secretStringValue: cdk.SecretValue.unsafePlainText(process.env.BROKER_CLIENT_SECRET ?? 'placeholder-for-local-synth'),
      });

      // Without this rule, the authenticate-oidc default action below would
      // apply to *every* path, including /health - external health checkers
      // would get a 302-to-login instead of a 200 and treat the service as
      // down. This higher-priority rule forwards /health straight through,
      // unauthenticated, matching the target group's own health check path.
      fargateService.listener.addAction('HealthCheckBypass', {
        priority: 1,
        conditions: [ListenerCondition.pathPatterns(['/health'])],
        action: ListenerAction.forward([fargateService.targetGroup]),
      });

      fargateService.listener.addAction('OidcAuth', {
        action: ListenerAction.authenticateOidc({
          issuer: config.broker.issuer,
          authorizationEndpoint: config.broker.authorizationEndpoint,
          tokenEndpoint: config.broker.tokenEndpoint,
          userInfoEndpoint: config.broker.userInfoEndpoint,
          clientId: process.env.BROKER_CLIENT_ID ?? 'placeholder-for-local-synth',
          // SecretValue.secretsManager() emits a CloudFormation dynamic
          // reference, not a literal, so the plaintext secret never appears
          // in the synthesized template.
          clientSecret: cdk.SecretValue.secretsManager(brokerClientSecret.secretArn),
          scope: 'openid profile email',
          onUnauthenticatedRequest: UnauthenticatedAction.AUTHENTICATE,
          next: ListenerAction.forward([fargateService.targetGroup]),
        }),
      });
    }

    // Restrict ALB ingress to an internal network only (via a managed
    // prefix list), instead of leaving 443 open to 0.0.0.0/0.
    if (config.managedPrefixList) {
      fargateService.loadBalancer.connections.allowFrom(
        ec2.Peer.prefixList(config.managedPrefixList),
        ec2.Port.tcp(443),
        'Allow intranet access via managed prefix list',
      );
    }

    new route53.ARecord(this, 'DnsRecord', {
      zone: hostedZone,
      recordName: 'example-service',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(fargateService.loadBalancer)),
    });

    /* -------------------- Outputs -------------------- */
    new cdk.CfnOutput(this, 'ServiceURL', { value: `https://${domainName}` });
    new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: fargateService.loadBalancer.loadBalancerDnsName });
  }
}
