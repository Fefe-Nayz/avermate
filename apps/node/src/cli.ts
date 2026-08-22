import { createNodeDaemon } from "./daemon";

const command = process.argv[2] ?? "doctor";
if (command !== "doctor") {
  console.error("Usage: bun src/cli.ts doctor");
  process.exit(2);
}

try {
  const daemon = await createNodeDaemon();
  const capabilities = await daemon.storage.capabilities();
  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: daemon.config.profile,
        protocol: "avermate-node/2",
        storage: capabilities,
        conversations: {
          available: false,
          reason: "CONVERSATION_STORE_NOT_CONFORMANT",
        },
        retrieval: {
          available: false,
          reason: "LEXICAL_BACKEND_NOT_CONFORMANT",
        },
        sandbox: { available: false, reason: "DISABLED_BY_PROFILE" },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }));
  process.exit(1);
}
