# api

Control Plane composition root: NestJS (Fastify adapter) wiring the identity,
organization and classroom bounded contexts to PostgreSQL. Serves the built
teacher portal SPA from `apps/web/dist` on the same origin.

Endpoints: `/health/live`, `/health/ready`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me`, `GET|POST /api/classrooms`.
