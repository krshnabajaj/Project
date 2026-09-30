import { z } from "zod";

/**
 * Server-side environment, validated once. Integration credentials are optional
 * at boot so the app can start before they are configured; each integration
 * reports a clear "not configured" status instead of failing silently.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: optionalString,
  ENCRYPTION_KEY: optionalString,
  CRON_SECRET: optionalString,
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  GMAIL_USER: optionalString,
  GMAIL_PUBSUB_TOPIC: optionalString,
  GMAIL_PUBSUB_AUDIENCE: optionalString,
  GMAIL_PUBSUB_SERVICE_ACCOUNT: optionalString,
  GMAIL_POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),

  WHATSAPP_PROVIDER: z.enum(["meta", "twilio", "disabled"]).default("disabled"),
  WHATSAPP_API_URL: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_FROM_NUMBER: optionalString,
  WHATSAPP_TEMPLATE_NAME: optionalString,
  WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
  ADMIN_WHATSAPP_NUMBER: optionalString,

  EMAIL_PROVIDER: z.enum(["smtp", "gmail", "disabled"]).default("smtp"),
  EMAIL_FROM: optionalString,
  ADMIN_EMAIL: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,

  STORAGE_PROVIDER: z.enum(["s3", "local"]).default("local"),
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_REGION: z.string().default("auto"),
  STORAGE_ENDPOINT: optionalString,
  STORAGE_FORCE_PATH_STYLE: bool,
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (!parsed.data.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET must be set in production");
    if (parsed.data.STORAGE_PROVIDER === "local" && process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== "true") {
      throw new Error(
        "STORAGE_PROVIDER=local is not allowed in production. Configure S3/R2/Supabase storage " +
          "(or set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true for a single-server deployment with a persistent volume).",
      );
    }
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: force re-reading process.env. */
export function resetEnvCache() {
  cached = null;
}

export function maxUploadBytes() {
  return Math.round(env().MAX_UPLOAD_MB * 1024 * 1024);
}
