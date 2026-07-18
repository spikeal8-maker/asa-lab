import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from './app';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('api health endpoints (in-process)', () => {
  it('reports liveness with 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
  });

  it('reports not_ready with 503 while dependencies are unconfirmed', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('not_ready');
    expect(response.json().dependencies).toMatchObject({
      database: 'unknown',
      redis: 'unknown',
      objectStorage: 'unknown',
    });
  });

  it('sets a request id header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
