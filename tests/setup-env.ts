// Runs before each test file's imports: point everything at the isolated test database/storage.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://omsapp:omsapp@localhost:5432/oms_test?schema=public";
process.env.APP_URL = "http://localhost:3000";
process.env.APP_TIMEZONE = "Asia/Kolkata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.NEXTAUTH_SECRET = "test-secret";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_DIR = "./test-storage";
process.env.WHATSAPP_PROVIDER = "disabled";
process.env.EMAIL_PROVIDER = "smtp";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2526";
process.env.SMTP_SECURE = "false";
process.env.EMAIL_FROM = "Tracker <tracker@test.local>";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_WHATSAPP_NUMBER = "+919800000001";
process.env.MAX_UPLOAD_MB = "10";
