import type {
  SandboxProviderId,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";

export type PortableWorkspaceFile = {
  relativePath: string;
  bytes: Uint8Array;
  mode?: number;
};

export interface PortableWorkspaceSnapshotStore {
  capture(input: {
    provider: SandboxProviderId;
    ownerId: string;
    files: readonly PortableWorkspaceFile[];
  }): Promise<SandboxWorkspaceSnapshotRef>;
  restore(input: {
    ref: SandboxWorkspaceSnapshotRef;
    ownerId: string;
    maximumBytes: number;
    maximumFiles: number;
  }): Promise<readonly PortableWorkspaceFile[]>;
}
