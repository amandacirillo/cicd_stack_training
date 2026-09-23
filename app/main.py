"""
A deliberately tiny FastAPI app. It exists only to give the CI/CD pipeline
and CDK stack something real to build, test, containerize and deploy - the
point of this training repo is the *pipeline and infra*, not the app.
"""
import os

from fastapi import FastAPI

app = FastAPI(title="CI/CD Stack Training App")


@app.get("/health")
def health() -> dict:
    """
    Unauthenticated health check endpoint.

    Why this matters for the infra: the ALB target group AND (when OIDC auth
    is enabled on the listener) a dedicated listener rule both point at this
    exact path. If you rename it, update cdk/lib/example_service_stack.ts in
    two places or your health checks silently break / your OIDC bypass rule
    stops matching and the load balancer starts treating your service as
    unhealthy or blocks external health-checkers with a login redirect.
    """
    return {"status": "ok"}


@app.get("/")
def index() -> dict:
    return {
        "message": "cicd_stack_training",
        "environment": os.environ.get("ENVIRONMENT", "local"),
    }
