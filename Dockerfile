### ---- Build stage: compile any deps that need a C toolchain ----
# Mirrors wilbur-template-editor's Dockerfile: install into an isolated
# --prefix so gcc/build-essential never end up in the final runtime image.
FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

### ---- Runtime stage: slim image, no build toolchain, non-root user ----
FROM python:3.12-slim
RUN groupadd --system app && useradd --system --gid app --home-dir /app --no-create-home app
WORKDIR /app
COPY --from=builder /install /usr/local
COPY --chown=app:app app/ ./app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
