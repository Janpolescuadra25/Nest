// Global test setup
// No database connection needed for unit tests
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder';

// Each test file handles its own mocks
