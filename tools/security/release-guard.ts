import { runGitleaks } from "./run-gitleaks";
import { runPersonalDataGuard } from "./personal-data";

export async function runReleaseGuard(): Promise<void> {
  await runGitleaks("workspace");
  await runGitleaks("history");
  await runPersonalDataGuard();
  console.log("Release security guard passed.");
}

if (import.meta.main) {
  try {
    await runReleaseGuard();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Release guard failed.",
    );
    process.exit(1);
  }
}
