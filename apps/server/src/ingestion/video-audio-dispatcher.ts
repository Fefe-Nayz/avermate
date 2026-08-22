import type { SandboxExecutionProfile } from "@avermate/agent-contracts";
import {
  videoAudioExtractWorkerInputSchema,
  videoAudioExtractWorkerManifestV1Schema,
} from "@avermate/agent-contracts";
import type { SandboxJobAdmission } from "../sandbox/job-admission";
import { AdvancedIngestionError } from "./errors";
import { ADVANCED_MEDIA_EXECUTION_PROFILES } from "./execution-profiles";
import type { ObjectStorageManifestStore } from "./object-manifest-store";
import type { VideoAudioFallbackDispatcher } from "./video-source-adapter";

export interface VideoExtractionEgressAttestor {
  attestYoutube(input: {
    ownerId: string;
    canonicalUrl: string;
  }): Promise<
    | {
        ok: true;
        runtimeEnforced: true;
        providerAllowlist: readonly ["youtube"];
        revalidatesEveryConnection: true;
        policyDigest: string;
      }
    | { ok: false; reason: string }
  >;
}

export class SandboxedVideoAudioExtractionDispatcher
  implements VideoAudioFallbackDispatcher
{
  constructor(
    private readonly dependencies: {
      placement: "node" | "self-host" | "hosted";
      hostedManagedEnabled: boolean;
      admission: SandboxJobAdmission;
      manifestStore: ObjectStorageManifestStore;
      egress: VideoExtractionEgressAttestor;
      profile: SandboxExecutionProfile;
      maxDurationSeconds?: number;
      maxDownloadBytes?: number;
    },
  ) {}

  async enqueue(input: Parameters<VideoAudioFallbackDispatcher["enqueue"]>[0]) {
    if (
      this.dependencies.placement === "hosted" &&
      !this.dependencies.hostedManagedEnabled
    ) {
      throw new AdvancedIngestionError(
        "capability_disabled",
        "Hosted audio extraction is disabled until managed abuse and quota gates pass",
        false,
      );
    }
    if (this.dependencies.placement === "hosted") {
      throw new AdvancedIngestionError(
        "capability_disabled",
        "Hosted audio extraction is not enabled by plan 033",
        false,
      );
    }
    const productProfile =
      ADVANCED_MEDIA_EXECUTION_PROFILES["video-audio-extract.v1"];
    if (
      !this.dependencies.profile.enabled ||
      this.dependencies.profile.id !== productProfile.sandboxProfileId
    ) {
      throw new AdvancedIngestionError(
        "placement_unavailable",
        "The selected node has no conforming video extraction profile",
        false,
      );
    }
    const egress = await this.dependencies.egress.attestYoutube({
      ownerId: input.ownerId,
      canonicalUrl: input.canonicalUrl,
    });
    if (!egress.ok || !egress.runtimeEnforced || !egress.revalidatesEveryConnection) {
      throw new AdvancedIngestionError(
        "placement_unavailable",
        "Video extraction requires a runtime-enforced YouTube-only egress policy",
        false,
      );
    }
    const request = videoAudioExtractWorkerInputSchema.parse({
      schemaVersion: 1,
      canonicalUrl: input.canonicalUrl,
      provider: "youtube",
      maxDurationSeconds: this.dependencies.maxDurationSeconds ?? 2 * 60 * 60,
      maxDownloadBytes: this.dependencies.maxDownloadBytes ?? 512 * 1024 * 1024,
      outputCodec: "wav-pcm-s16le",
    });
    const manifest = await this.dependencies.manifestStore.put({
      ownerId: input.ownerId,
      namespace: "sandbox-inputs",
      kind: `video-audio/${input.sourceVersionId}`,
      value: videoAudioExtractWorkerManifestV1Schema.parse({
        schemaVersion: 1,
        worker: "video-audio-extract.v1",
        request,
        requestedLanguage: input.requestedLanguage,
        consentRevision: input.consentRevision,
        egressPolicyDigest: egress.policyDigest,
      }),
      idempotencyKey: `video-audio-input:${input.idempotencyKey}`,
    });
    const job = await this.dependencies.admission.enqueue({
      workerId: "video-audio-extract.v1",
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profile: this.dependencies.profile,
      inputManifestRef: manifest.manifestRef,
      executable: productProfile.executable,
      argv: productProfile.argv,
      idempotencyKey: input.idempotencyKey,
      resources: {
        wallTimeMs: Math.min(
          this.dependencies.profile.resources.wallTimeMs,
          15 * 60_000,
        ),
        outputBytes: Math.min(
          this.dependencies.profile.resources.outputBytes,
          512 * 1024 * 1024,
        ),
      },
    });
    const placement =
      this.dependencies.placement === "node" ? "node" : "self-host";
    return {
      jobId: job.id,
      placement,
    } as const;
  }
}
