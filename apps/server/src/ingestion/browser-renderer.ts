import type {
  BrowserRenderWorkerInput,
  BrowserRenderWorkerOutput,
  SandboxExecutionProfile,
} from "@avermate/agent-contracts";
import {
  browserCaptureWorkerManifestV1Schema,
  browserRenderWorkerInputSchema,
  browserRenderWorkerOutputSchema,
} from "@avermate/agent-contracts";
import type { JobRuntimeRecord } from "../jobs/job-runtime";
import type { SandboxJobAdmission } from "../sandbox/job-admission";
import { AdvancedIngestionError } from "./errors";
import { ADVANCED_MEDIA_EXECUTION_PROFILES } from "./execution-profiles";
import type { ObjectStorageManifestStore } from "./object-manifest-store";
import type { PublicIngestionUrlPolicy } from "./url-policy";

export interface DynamicBrowserEgressAttestor {
  attest(input: {
    ownerId: string;
    canonicalUrl: string;
    policyRef: string;
  }): Promise<
    | {
        ok: true;
        runtimeEnforced: true;
        policyDigest: string;
        revalidatesEveryConnection: true;
      }
    | { ok: false; reason: string }
  >;
}

/**
 * API-side browser work only validates and queues a structured sandbox job.
 * Chromium/Playwright is never imported or executed in this process.
 */
export class BrowserRenderDispatcher {
  constructor(
    private readonly dependencies: {
      admission: SandboxJobAdmission;
      manifestStore: ObjectStorageManifestStore;
      urlPolicy: PublicIngestionUrlPolicy;
      egress: DynamicBrowserEgressAttestor;
      profile: SandboxExecutionProfile;
    },
  ) {}

  async enqueue(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    sourceId: string;
    canonicalUrl: string;
    policyRef: string;
    maxNavigations?: number;
    maxRequests?: number;
    maxResponseBytes?: number;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<{ job: JobRuntimeRecord; request: BrowserRenderWorkerInput }> {
    const profile = ADVANCED_MEDIA_EXECUTION_PROFILES["web-render.v1"];
    if (
      this.dependencies.profile.id !== profile.sandboxProfileId ||
      !this.dependencies.profile.enabled
    ) {
      throw new AdvancedIngestionError(
        "placement_unavailable",
        "Dynamic Web rendering is not available on the selected execution placement",
        false,
      );
    }
    const destination = await this.dependencies.urlPolicy.validate(
      input.canonicalUrl,
      "main-navigation",
      input.signal,
    );
    const egress = await this.dependencies.egress.attest({
      ownerId: input.ownerId,
      canonicalUrl: destination.url,
      policyRef: input.policyRef,
    });
    if (!egress.ok || !egress.runtimeEnforced || !egress.revalidatesEveryConnection) {
      throw new AdvancedIngestionError(
        "placement_unavailable",
        "Dynamic rendering requires a runtime-enforced revalidating egress policy",
        false,
      );
    }
    const request = browserRenderWorkerInputSchema.parse({
      schemaVersion: 1,
      url: destination.url,
      wait: { kind: "dom-settled", maxMs: 8_000 },
      maxNavigations: input.maxNavigations ?? 8,
      maxRequests: input.maxRequests ?? 250,
      maxResponseBytes: input.maxResponseBytes ?? 5 * 1024 * 1024,
      capture: ["readable-html", "metadata", "selected-images"],
    });
    const manifest = await this.dependencies.manifestStore.put({
      ownerId: input.ownerId,
      namespace: "sandbox-inputs",
      kind: `web-render/${input.sourceId}`,
      value: browserCaptureWorkerManifestV1Schema.parse({
        schemaVersion: 1,
        worker: "browser-capture.v1",
        request,
        egressPolicyDigest: egress.policyDigest,
      }),
      idempotencyKey: `web-render-input:${input.idempotencyKey}`,
    });
    const job = await this.dependencies.admission.enqueue({
      workerId: "browser-capture.v1",
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profile: this.dependencies.profile,
      inputManifestRef: manifest.manifestRef,
      executable: profile.executable,
      argv: profile.argv,
      idempotencyKey: input.idempotencyKey,
      resources: {
        wallTimeMs: 120_000,
        outputBytes: 64 * 1024 * 1024,
      },
    });
    return { job, request };
  }
}

export function parseBrowserRenderWorkerOutput(
  value: unknown,
): BrowserRenderWorkerOutput {
  return browserRenderWorkerOutputSchema.parse(value);
}
