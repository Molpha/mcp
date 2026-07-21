import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export function loadDotenv(): void {
  const candidates = [process.env.MOLPHA_ENV_FILE, ".env"].filter(
    (value): value is string => Boolean(value && value.trim().length > 0)
  );

  for (const candidate of candidates) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      config({ path, override: false });
      return;
    }
  }
}

loadDotenv();
