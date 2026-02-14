import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisIoAdapter } from '../src/gateway/adapters/redis-io.adapter';

describe('LinkingChat Server (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let httpServer: any;

  // Test user credentials
  const testUser = {
    email: `e2e-${Date.now()}@test.com`,
    username: `e2euser${Date.now()}`,
    password: 'TestPass123!',
    displayName: 'E2E Test User',
  };
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    const swaggerConfig = new DocumentBuilder()
      .setTitle('LinkingChat API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    await app.init();
    await app.listen(0); // random port

    httpServer = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup test data — find user first, then delete related records
    const user = await prisma.user
      .findUnique({ where: { email: testUser.email } })
      .catch(() => null);

    if (user) {
      await prisma.refreshToken
        .deleteMany({ where: { userId: user.id } })
        .catch(() => {});
      await prisma.command
        .deleteMany({ where: { issuerId: user.id } })
        .catch(() => {});
      await prisma.device
        .deleteMany({ where: { userId: user.id } })
        .catch(() => {});
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => {});
    }

    await app.close();
  });

  // ─── M1: Auth Flow ─────────────────────────────────────────────

  describe('M1: Auth endpoints', () => {
    it('POST /api/v1/auth/register — should create a new user', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(testUser.email);
      expect(res.body.user.username).toBe(testUser.username);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('POST /api/v1/auth/register — should reject duplicate email', async () => {
      await request(httpServer)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(409);
    });

    it('POST /api/v1/auth/login — should authenticate', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('POST /api/v1/auth/login — should reject bad password', async () => {
      await request(httpServer)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'wrong' })
        .expect(401);
    });

    it('POST /api/v1/auth/refresh — should rotate tokens', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.refreshToken).not.toBe(refreshToken);

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('GET /api/v1/devices — should require authentication', async () => {
      await request(httpServer).get('/api/v1/devices').expect(401);
    });

    it('GET /api/v1/devices — should work with valid JWT', async () => {
      const res = await request(httpServer)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── M2: WebSocket Gateway ────────────────────────────────────

  describe('M2: WebSocket /device namespace', () => {
    let wsClient: ClientSocket;
    const testDeviceId = `e2e-device-${Date.now()}`;

    afterEach((done) => {
      if (wsClient?.connected) {
        wsClient.disconnect();
      }
      done();
    });

    it('should reject connection without token', (done) => {
      const address = httpServer.address();
      const url = `http://127.0.0.1:${address.port}/device`;

      wsClient = io(url, {
        transports: ['websocket'],
        auth: {},
      });

      wsClient.on('connect_error', (err) => {
        expect(err.message).toContain('AUTH_MISSING');
        done();
      });
    });

    it('should reject connection with invalid token', (done) => {
      const address = httpServer.address();
      const url = `http://127.0.0.1:${address.port}/device`;

      wsClient = io(url, {
        transports: ['websocket'],
        auth: { token: 'invalid.jwt.token' },
      });

      wsClient.on('connect_error', (err) => {
        expect(err.message).toContain('AUTH_INVALID');
        done();
      });
    });

    it('should connect with valid JWT and register device', (done) => {
      const address = httpServer.address();
      const url = `http://127.0.0.1:${address.port}/device`;

      wsClient = io(url, {
        transports: ['websocket'],
        auth: {
          token: accessToken,
          deviceType: 'desktop',
          deviceId: testDeviceId,
        },
      });

      wsClient.on('connect', () => {
        // Connected successfully — send device:register
        wsClient.emit(
          'device:register',
          {
            deviceId: testDeviceId,
            name: 'E2E Test Desktop',
            platform: 'win32',
          },
          (response: any) => {
            expect(response.success).toBe(true);
            expect(response.data).toHaveProperty('deviceId');
            done();
          },
        );
      });

      wsClient.on('connect_error', (err) => {
        done(new Error(`WS connect failed: ${err.message}`));
      });
    });

    it('should block dangerous commands', (done) => {
      const address = httpServer.address();
      const url = `http://127.0.0.1:${address.port}/device`;

      wsClient = io(url, {
        transports: ['websocket'],
        auth: {
          token: accessToken,
          deviceType: 'web',
        },
      });

      wsClient.on('connect', () => {
        wsClient.emit(
          'device:command:send',
          {
            requestId: 'test-req-1',
            data: {
              targetDeviceId: testDeviceId,
              type: 'shell',
              action: 'rm -rf /',
            },
          },
          (response: any) => {
            expect(response.success).toBe(false);
            expect(response.error.code).toBe('COMMAND_DANGEROUS');
            done();
          },
        );
      });
    });
  });

  // ─── Swagger ──────────────────────────────────────────────────

  describe('Swagger docs', () => {
    it('GET /api/docs — should serve Swagger UI', async () => {
      const res = await request(httpServer)
        .get('/api/docs')
        .expect(200);

      expect(res.text).toContain('swagger');
    });
  });
});
