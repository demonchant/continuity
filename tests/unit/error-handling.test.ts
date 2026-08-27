import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { validateBody } from '../../src/middleware/validate.js';
import { AppError } from '../../src/utils/errors.js';

describe('request errors', () => {
  it('formats validation errors', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', validateBody(z.object({ name: z.string().min(1) })), (_request, response) =>
      response.sendStatus(204),
    );
    app.use(errorHandler);
    const response = await request(app).post('/test').send({ name: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('formats application errors', async () => {
    const app = express();
    app.get('/test', () => {
      throw new AppError('CONFLICT', 'Conflict', 409);
    });
    app.use(errorHandler);
    const response = await request(app).get('/test');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'Conflict' },
    });
  });
});
