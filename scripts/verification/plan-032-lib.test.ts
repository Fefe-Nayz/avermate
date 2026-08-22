import { describe, expect, test } from "bun:test";
import { classifyDockerHostFailure } from "./plan-032-lib";

describe("Plan 032 Docker host diagnostics", () => {
  test("identifies Docker Desktop/containerd content-store corruption", () => {
    expect(
      classifyDockerHostFailure(
        "docker-content-store",
        "write /var/lib/docker/buildkit/containerd-overlayfs/metadata_v2.db: input/output error",
      ),
    ).toStartWith("PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY:");
    expect(
      classifyDockerHostFailure(
        "docker-content-store",
        "request returned 500 Internal Server Error for /system/df",
      ),
    ).toStartWith("PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY:");
  });

  test("identifies an unavailable daemon independently from product failures", () => {
    expect(
      classifyDockerHostFailure(
        "docker-info",
        "request returned 502 Bad Gateway for API route and version",
      ),
    ).toStartWith("PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE:");
    expect(
      classifyDockerHostFailure(
        "docker-info",
        "Docker host probe timed out after 20000ms",
      ),
    ).toStartWith("PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE:");
  });

  test("keeps unknown preflight failures explicitly host-scoped", () => {
    expect(classifyDockerHostFailure("docker-info", "permission denied")).toBe(
      "PLAN032_DOCKER_HOST_PREFLIGHT_FAILED:docker-info:permission denied",
    );
  });
});
