# CI/CD & CDK Stack Training

> **Note:** This is a from-scratch recreation of an architectural pattern I built at my employer, not the original production code -- rebuilt with a fabricated/generic domain and no proprietary business logic, credentials, or internal resource identifiers.

A small, runnable model of the **GitLab CI/CD + AWS CDK stack** pattern used
by `wilbur-template-editor`. It is a standalone training repo, deliberately
stripped down and using **fake placeholder AWS IDs** (no real account
numbers, VPCs, subnets, hosted zones or certificates) - the goal is to teach
the *pattern*, safely, not to ship a deployable clone of a production
service.

## What This Teaches

1. **Multi-stage pipelines with an environment gate.** `build → test →
   deploy`, one job per environment (sandbox/nonprod/prod), each gated by
   GitLab's `only:` branch rules and an `environment:` block.
2. **AssumeRole instead of static AWS keys.** The `.assume_role` YAML anchor
   in `.gitlab-ci.yml` is the single most reusable idea here: a runner with
   an instance role calls `sts:assume-role` at pipeline run time, so no
   long-lived AWS access key ever lives in a GitLab CI/CD variable.
3. **Multi-stage Docker builds.** Compile-time deps (gcc, build-essential)
   never reach the runtime image; the app runs as a non-root user.
4. **CDK stacks parameterized by environment**, not duplicated - one
   `ExampleServiceStack` class, one config object per environment
   (`cdk/lib/config/environments.ts`), selected via `--context environment=`.
5. **Passing the pipeline's build output into the deploy step** via
   CDK context (`--context imageTag=$IMAGE_TAG`) instead of hardcoding a tag.
6. **Secrets Manager, not env vars, for real credentials** - and CloudFormation
   dynamic references (`SecretValue.secretsManager(...)`) so plaintext
   secrets never appear in a synthesized template.
7. **ECR lifecycle policies** so old images don't accumulate forever.
8. **CloudWatch Logs retention** - the ECS `awsLogs` driver's default is to
   keep logs forever; this stack sets an explicit retention period.
9. **Optional ALB `authenticate-oidc` auth**, with a *higher-priority*
   listener rule that bypasses auth for `/health` - without it, external
   health checkers get a 302-to-login and mark the service "down".

## Project Layout

```
app/main.py             FastAPI app with a /health endpoint (what gets deployed)
tests/test_health.py    what the pipeline's `test` stage actually runs
Dockerfile              multi-stage build -> slim, non-root runtime image
requirements*.txt       app deps / dev+test deps

cdk/
  bin/app.ts             entry point - reads --context environment, looks up config
  lib/example_service_stack.ts   ECS Fargate + ALB + Route53 + ACM + ECR + Secrets + Logs
  lib/config/environments.ts     sandbox / nonprod / prod config (placeholder IDs)
  package.json, tsconfig.json, cdk.json

.gitlab-ci.yml          build -> test -> deploy pipeline, one job set per environment
```

## Try It

### Run the app + tests locally
```powershell
cd C:\PythonProjects\cicd_stack_training
pip install -r requirements-dev.txt
pytest -v
uvicorn app.main:app --reload   # then curl http://localhost:8000/health
```

### Build the Docker image
```powershell
docker build -t cicd-stack-training:local .
docker run -p 8000:8000 cicd-stack-training:local
```

### Type-check the CDK stack (no AWS account needed)
```powershell
cd cdk
npm install
npx tsc --noEmit
```
This validates the TypeScript compiles cleanly - catches typos/type errors
in the stack without touching AWS.

### Inspect the CDK stack (requires a real AWS account)
```powershell
npx cdk synth --context environment=sandbox --context ecrRepositoryName=example-service-sandbox --context arnPrefix=arn:aws:acm:us-east-1:111111111111
```
This prints the full CloudFormation template that would be deployed - a
great way to see exactly what the CDK constructs above translate into.

> `cdk synth`/`cdk deploy` need a real AWS account with a real VPC, subnets,
> hosted zone and ACM certificate substituted into
> `cdk/lib/config/environments.ts` - the placeholder IDs here will fail
> `ec2.Vpc.fromLookup` / `route53.HostedZone.fromLookup` (they need valid AWS
> credentials to query real resources), by design. `npx tsc --noEmit` above
> is the offline-friendly way to validate the code itself.

## Exercises (for training)

1. **Add an environment.** Add a `qa` entry to `environments.ts` and matching
   `build_and_push_qa` / `deploy_qa` jobs to `.gitlab-ci.yml` (copy the
   `nonprod` jobs and rename). This is the exact motion for onboarding a new
   deploy target.
2. **Break the AssumeRole chain on purpose.** Comment out the `unset
   AWS_ACCESS_KEY_ID ...` line in `.assume_role` and think through why
   leftover credentials from a previous job step could silently cause a
   deploy to hit the wrong AWS account.
3. **Remove the `/health` bypass listener rule** (in
   `example_service_stack.ts`, inside the `if (config.broker)` block) and
   trace through what would happen to health checks once OIDC auth is
   enabled for `nonprod`/`prod`.
4. **Turn on `desiredCount: 2` for sandbox** and re-run `cdk synth` - see how
   a single config number ripples into the synthesized `AutoScalingGroup`/
   `Service` properties.
5. **Add a new stat... er, secret.** Add a second Secrets-Manager-backed env
   var (e.g. `ANOTHER_API_KEY`) following the `exampleApiKeySecret` pattern,
   and wire a new required CI/CD variable for it in the `.gitlab-ci.yml`
   header comment table.
