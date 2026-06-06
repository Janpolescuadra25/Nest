"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const zod_1 = require("zod");
const errors_1 = require("../src/lib/errors");
describe('AppError', () => {
    it('sets message, default status, and name', () => {
        const error = new errors_1.AppError('Something broke');
        expect(error.message).toBe('Something broke');
        expect(error.status).toBe(500);
        expect(error.name).toBe('AppError');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(errors_1.AppError);
    });
    it('accepts a custom status code', () => {
        const error = new errors_1.AppError('Bad request', 400);
        expect(error.status).toBe(400);
    });
});
describe('ValidationError', () => {
    it('wraps a ZodError with status 400 and field details', () => {
        const issues = [
            { path: ['email'], message: 'Invalid email', code: 'custom' },
            { path: ['email'], message: 'Must contain @', code: 'custom' },
            { path: ['name'], message: 'Required', code: 'custom' },
        ];
        const zodError = new zod_1.ZodError(issues);
        const error = new errors_1.ValidationError(zodError);
        expect(error).toBeInstanceOf(errors_1.AppError);
        expect(error.status).toBe(400);
        expect(error.name).toBe('ValidationError');
        expect(error.fields).toEqual({
            email: 'Invalid email, Must contain @',
            name: 'Required',
        });
        expect(error.message).toBe(zodError.message);
    });
});
describe('asyncHandler and createErrorHandler integration', () => {
    let app;
    const originalNodeEnv = process.env.NODE_ENV;
    beforeAll(() => {
        process.env.NODE_ENV = 'production';
        app = (0, express_1.default)();
        app.get('/success', (0, errors_1.asyncHandler)(async (_req, res) => {
            res.json({ data: 'ok' });
        }));
        app.get('/throw-app-error', (0, errors_1.asyncHandler)(async () => {
            throw new errors_1.AppError('Test error', 400);
        }));
        app.get('/throw-generic-error', (0, errors_1.asyncHandler)(async () => {
            throw new Error('Generic failure');
        }));
        app.get('/throw-rejection', (0, errors_1.asyncHandler)(async () => {
            return Promise.reject(new errors_1.AppError('Rejected', 400));
        }));
        app.use((0, errors_1.createErrorHandler)());
    });
    afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });
    it('returns success from a normal async route', async () => {
        const response = await (0, supertest_1.default)(app).get('/success');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ data: 'ok' });
    });
    it('passes AppError through createErrorHandler with correct status and body', async () => {
        const response = await (0, supertest_1.default)(app).get('/throw-app-error');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Test error' });
    });
    it('returns internal server error for generic Error', async () => {
        const response = await (0, supertest_1.default)(app).get('/throw-generic-error');
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Internal server error' });
    });
    it('handles rejected promises and passes them to next()', async () => {
        const response = await (0, supertest_1.default)(app).get('/throw-rejection');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Rejected' });
    });
});
//# sourceMappingURL=errors.test.js.map