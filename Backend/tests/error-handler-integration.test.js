"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const errors_1 = require("../src/lib/errors");
describe('global error middleware integration', () => {
    let app;
    const originalNodeEnv = process.env.NODE_ENV;
    beforeAll(() => {
        process.env.NODE_ENV = 'production';
        app = (0, express_1.default)();
        app.get('/throw-app-error', (0, errors_1.asyncHandler)(async (_req, res) => {
            throw new errors_1.AppError('Test error', 400);
        }));
        app.get('/throw-generic-error', (0, errors_1.asyncHandler)(async () => {
            throw new Error('Oops');
        }));
        app.get('/success', (0, errors_1.asyncHandler)(async (_req, res) => {
            res.json({ data: 'ok' });
        }));
        app.use((0, errors_1.createErrorHandler)());
    });
    afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });
    it('returns 400 for AppError route', async () => {
        const response = await (0, supertest_1.default)(app).get('/throw-app-error');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Test error' });
    });
    it('returns 500 for generic error route', async () => {
        const response = await (0, supertest_1.default)(app).get('/throw-generic-error');
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
    });
    it('returns 200 for successful route', async () => {
        const response = await (0, supertest_1.default)(app).get('/success');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: 'ok' });
    });
    it('returns 404 for nonexistent routes', async () => {
        const response = await (0, supertest_1.default)(app).get('/no-route');
        expect(response.status).toBe(404);
    });
});
//# sourceMappingURL=error-handler-integration.test.js.map