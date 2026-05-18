process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/clutch_picks_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-clutch-picks-backend-suite";
process.env.BACKEND_URL ??= "http://localhost:3000";
