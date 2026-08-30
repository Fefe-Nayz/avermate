import type { ObjectStorageProvider, ObjectStoragePutInput, ObjectStorageStatInput } from "@avermate/agent-contracts";
import { capabilityArtifactPurpose } from "../lib/capability-artifact-policy";

/** Keeps Node-backed canonical files in their existing physical files namespace. */
export function capabilityNodeAdoptionStorage(provider: ObjectStorageProvider): ObjectStorageProvider {
  return new Proxy(provider, {
    get(target, property) {
      if (property === "put") return async (put: ObjectStoragePutInput) => {
        capabilityArtifactPurpose(put.ref.namespace);
        const committed = await target.put({ ...put, ref: { ...put.ref, namespace: "files" } });
        if (committed.ref.ownerId !== put.ref.ownerId || committed.ref.namespace !== "files" || committed.ref.key !== put.ref.key) throw new Error("ADOPTION_NODE_STORAGE_REF_MISMATCH");
        return { ...committed, ref: put.ref };
      };
      if (property === "stat") return async (stat: ObjectStorageStatInput) => {
        capabilityArtifactPurpose(stat.ref.namespace);
        const metadata = await target.stat({ ref: { ...stat.ref, namespace: "files" } });
        if (metadata && (metadata.ref.ownerId !== stat.ref.ownerId || metadata.ref.namespace !== "files" || metadata.ref.key !== stat.ref.key)) throw new Error("ADOPTION_NODE_STORAGE_REF_MISMATCH");
        return metadata ? { ...metadata, ref: stat.ref } : null;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
