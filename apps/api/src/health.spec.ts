import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from './app';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('api health endpoints', () => {
  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
  });

  it('reports readiness with declared dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');
  });

  it('sets a request id header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});
