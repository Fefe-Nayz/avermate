"""Bounded text-only Qwen3 reranker worker.

This intentionally implements the tiny Avermate `/rerank` response used by
the provider-neutral Node relay. It does not accept URLs, files,
plugins, arbitrary model ids or runtime downloads.
"""

from __future__ import annotations

import math
import os
import re
from contextlib import asynccontextmanager
from typing import Literal

import torch
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sentence_transformers import CrossEncoder

MODEL_ID = "Qwen/Qwen3-Reranker-0.6B"
REVIEWED_MODEL_REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473"
PROMPT_NAME = "avermate-french-school-learning-v1"
INSTRUCTION_PROMPT = (
    "Given a French school-learning query, retrieve passages that directly "
    "answer the learner's question using curriculum-relevant evidence. Prefer "
    "precise, pedagogically useful passages in the query's language."
)
PREPROCESSING_REVISION = (
    "sha256:ef9a802ca5f4290952f308895a019a475295ef17b9c890cf9375cd3e8bc85cbf"
)
MAX_REQUEST_BYTES = 1024 * 1024
MAX_QUERY_CHARS = 16 * 1024
MAX_DOCUMENT_CHARS = 32 * 1024
MAX_DOCUMENTS = 128


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name}_REQUIRED")
    return value


def reviewed_configuration() -> tuple[str, str]:
    model_path = required_environment("QWEN3_RERANK_MODEL_PATH")
    revision = required_environment("QWEN3_RERANK_MODEL_REVISION")
    if revision != REVIEWED_MODEL_REVISION or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise RuntimeError("QWEN3_RERANK_MODEL_REVISION_NOT_REVIEWED")
    if not os.path.isabs(model_path) or not os.path.isdir(model_path):
        raise RuntimeError("QWEN3_RERANK_MODEL_PATH_INVALID")
    return model_path, revision


class RerankRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    query: str = Field(min_length=1, max_length=MAX_QUERY_CHARS)
    texts: list[str] = Field(min_length=1, max_length=MAX_DOCUMENTS)
    truncate: Literal[False]
    raw_scores: Literal[False]
    return_text: Literal[False]

    @field_validator("query")
    @classmethod
    def query_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("query must not be blank")
        return value

    @field_validator("texts")
    @classmethod
    def documents_are_bounded(cls, value: list[str]) -> list[str]:
        if any(not text.strip() or len(text) > MAX_DOCUMENT_CHARS for text in value):
            raise ValueError("document is blank or too large")
        return value

    @model_validator(mode="after")
    def aggregate_payload_is_bounded(self) -> "RerankRequest":
        if len(self.query.encode("utf-8")) + sum(
            len(text.encode("utf-8")) for text in self.texts
        ) > MAX_REQUEST_BYTES:
            raise ValueError("aggregate rerank payload is too large")
        return self


class Runtime:
    model: CrossEncoder | None = None
    revision: str | None = None


runtime = Runtime()


@asynccontextmanager
async def lifespan(_: FastAPI):
    model_path, revision = reviewed_configuration()
    runtime.model = CrossEncoder(
        model_path,
        local_files_only=True,
        trust_remote_code=False,
        max_length=8192,
        prompts={PROMPT_NAME: INSTRUCTION_PROMPT},
        default_prompt_name=PROMPT_NAME,
        model_kwargs={"local_files_only": True},
        tokenizer_kwargs={"local_files_only": True},
    )
    runtime.revision = revision
    yield
    runtime.model = None


app = FastAPI(
    title="Avermate reviewed Qwen3 reranker",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.middleware("http")
async def bound_request_body(request: Request, call_next):
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit() or int(declared) > MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"error": "REQUEST_SIZE_INVALID"})
    return await call_next(request)


@app.get("/health")
async def health():
    return {
        "ready": runtime.model is not None,
        "model": MODEL_ID,
        "modelRevision": runtime.revision,
        "promptName": PROMPT_NAME,
        "preprocessingRevision": PREPROCESSING_REVISION,
        "runtime": {
            "torch": torch.__version__,
            "sentenceTransformers": "5.4.0",
            "transformers": "4.57.3",
        },
        "modalities": ["text"],
        "tei": False,
    }


@app.post("/rerank")
async def rerank(body: RerankRequest):
    if runtime.model is None:
        return JSONResponse(status_code=503, content={"error": "MODEL_NOT_READY"})
    scores = runtime.model.predict(
        [(body.query, document) for document in body.texts],
        batch_size=min(8, len(body.texts)),
        show_progress_bar=False,
        activation_fn=torch.nn.Sigmoid(),
        convert_to_numpy=True,
    )
    normalized = [float(score) for score in scores]
    if any(not math.isfinite(score) for score in normalized):
        return JSONResponse(status_code=500, content={"error": "NON_FINITE_SCORE"})
    ordered = sorted(enumerate(normalized), key=lambda row: (-row[1], row[0]))
    return {
        "ranks": [
            {"index": index, "score": score}
            for index, score in ordered
        ]
    }
