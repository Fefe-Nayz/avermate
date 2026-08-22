# The build pipeline must pass an immutable base reference such as
# pytorch/pytorch:<reviewed-tag>@sha256:<verified-digest>. No default is
# provided because an unverifiable digest must never become release evidence.
ARG PYTORCH_BASE_IMAGE
FROM ${PYTORCH_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false
WORKDIR /worker
COPY infra/workers/qwen3-reranker/requirements.txt /worker/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /worker/requirements.txt
COPY infra/workers/qwen3-reranker/server.py /worker/server.py
RUN useradd --create-home --uid 65532 --shell /usr/sbin/nologin worker \
    && chown -R 65532:65532 /worker
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--workers", "1"]
