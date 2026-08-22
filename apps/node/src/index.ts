import { startNodeDaemon } from "./daemon";

const { daemon, server, stop } = await startNodeDaemon();

// The bootstrap value itself is intentionally not logged. The local operator
// reads it from the owner-only file under the configured data directory.
console.info(
  `[avermate-node] ${daemon.config.profile} listening on ${server.url} (setup secret: ${daemon.config.dataDir}/secrets/setup-bootstrap.secret)`,
);

const shutdown = () => {
  void stop().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
