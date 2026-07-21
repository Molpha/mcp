import { z } from "zod";

/** Shared apiConfig input shape for tools that accept a declarative feed source. */
export const apiConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  responseParser: z.string().min(1),
  valueTransform: z.string().optional()
});

export type ApiConfigSchema = z.infer<typeof apiConfigSchema>;
