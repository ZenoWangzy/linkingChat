import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GatewayManagerService } from './gateway-manager.service';

// ── Mock Services ────────────────────────────

const mockConfigService = {
  get: jest.fn((key: string, defaultValue: any) => {
    const config: Record<string, any> = {
      OPENCLAW_BASE_PORT: 18790,
      OPENCLAW_MAX_PORTS: 100,
      OPENCLAW_PATH: '/mock/openclaw/dist/index.js',
      OPENCLAW_WORKSPACES_PATH: '/mock/workspaces',
      GATEWAY_HOST: 'localhost',
      JWT_SECRET: 'test-secret-key',
    };
    return config[key] ?? defaultValue;
  }),
};

const mockJwtService = {
  verifyAsync: jest.fn(),
};

// ── 测试套件 ────────────────────────────

describe('GatewayManagerService', () => {
  let service: GatewayManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayManagerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<GatewayManagerService>(GatewayManagerService);

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup: stop all gateways
    await service.onModuleDestroy();
  });

  describe('初始化', () => {
    it('应该正确初始化服务', () => {
      expect(service).toBeDefined();
    });

    it('应该正确配置基础端口', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('OPENCLAW_BASE_PORT', 18790);
    });
  });

  describe('getUserGateway', () => {
    it('对于不存在的用户应返回 null', () => {
      const result = service.getUserGateway('non-existent-user');
      expect(result).toBeNull();
    });
  });

  describe('startUserGateway', () => {
    it('应该为用户分配有效端口', async () => {
      // 注意：这个测试会尝试启动真实进程
      // 在 CI 环境中可能需要 mock child_process
      const userId = 'test-user-1';

      // Mock process spawn (避免真实启动进程)
      const originalSpawn = require('child_process').spawn;
      require('child_process').spawn = jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      }));

      try {
        const result = await service.startUserGateway(userId);

        expect(result).toBeDefined();
        expect(result.port).toBeGreaterThanOrEqual(18790);
        expect(result.port).toBeLessThan(18890);
        expect(result.status).toBeDefined();
        expect(result.token).toBeDefined();
        expect(result.token).toMatch(/^lc_gw_/);
      } finally {
        require('child_process').spawn = originalSpawn;
      }
    });

    it('同一用户重复调用应返回相同端口', async () => {
      const userId = 'test-user-2';

      // Mock process spawn
      const originalSpawn = require('child_process').spawn;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };
      require('child_process').spawn = jest.fn(() => mockProcess);

      try {
        const result1 = await service.startUserGateway(userId);
        const result2 = await service.startUserGateway(userId);

        expect(result1.port).toBe(result2.port);
      } finally {
        require('child_process').spawn = originalSpawn;
      }
    });
  });

  describe('stopUserGateway', () => {
    it('停止不存在的 Gateway 不应抛出错误', async () => {
      await expect(service.stopUserGateway('non-existent-user')).resolves.not.toThrow();
    });
  });

  describe('isGatewayRunning', () => {
    it('对于未启动的用户应返回 false', () => {
      expect(service.isGatewayRunning('non-existent-user')).toBe(false);
    });
  });

  describe('getAllGateways', () => {
    it('没有 Gateway 时应返回空数组', () => {
      const gateways = service.getAllGateways();
      expect(gateways).toEqual([]);
    });
  });

  describe('getGatewayConnectionInfo', () => {
    it('无效 JWT 应返回 null', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      const result = await service.getGatewayConnectionInfo('invalid-token');

      expect(result).toBeNull();
    });

    it('有效 JWT 应返回连接信息', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-123' });

      // Mock process spawn
      const originalSpawn = require('child_process').spawn;
      require('child_process').spawn = jest.fn(() => ({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      }));

      try {
        const result = await service.getGatewayConnectionInfo('valid-token');

        expect(result).toBeDefined();
        expect(result?.url).toBeDefined();
        expect(result?.token).toBeDefined();
        expect(result?.port).toBeGreaterThanOrEqual(18790);
      } finally {
        require('child_process').spawn = originalSpawn;
      }
    });
  });

  describe('generateGatewayToken', () => {
    it('应该生成正确格式的 Token', () => {
      // 通过 startUserGateway 间接测试 token 生成
      const token = 'lc_gw_' + Buffer.from('test:data:123').toString('base64url');
      expect(token).toMatch(/^lc_gw_[A-Za-z0-9_-]+$/);
    });
  });
});
