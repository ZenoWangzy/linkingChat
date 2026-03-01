# Phase 8 Profile 页面实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现用户个人资料页面，支持头像上传、昵称编辑、状态管理和设备管理

**Architecture:** 模块化分层架构 - 后端 ProfileModule + UploadModule，前端 Flutter/Desktop 共享设计规范

**Tech Stack:** NestJS 11 + Prisma 6 + MinIO + Sharp | Flutter + Riverpod | React + TypeScript

---

## Task 1: 创建 ProfileModule 和 DTO

**Files:**
- Create: `apps/server/src/profile/profile.module.ts`
- Create: `apps/server/src/profile/dto/update-profile.dto.ts`

**Step 1: 创建 UpdateProfileDto**

```typescript
// apps/server/src/profile/dto/update-profile.dto.ts
import { IsString, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '昵称长度必须至少 1 个字符' })
  @MaxLength(64, { message: '昵称长度不能超过 64 个字符' })
  displayName?: string;

  @IsOptional()
  @IsEnum(UserStatus, { message: '状态必须是有效的用户状态' })
  status?: UserStatus;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
```

**Step 2: 创建 ProfileModule**

```typescript
// apps/server/src/profile/profile.module.ts
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [PrismaModule, UploadModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
```

**Step 3: 验证文件已创建**

Run: `ls -la apps/server/src/profile/`
Expected: 应该看到 `profile.module.ts` 和 `dto/` 目录

**Step 4: Commit**

```bash
git add apps/server/src/profile/
git commit -m "feat(profile): add ProfileModule and UpdateProfileDto"
```

---

## Task 2: 编写 ProfileService 单元测试

**Files:**
- Create: `apps/server/src/profile/__tests__/profile.service.spec.ts`

**Step 1: 创建测试文件骨架**

```typescript
// apps/server/src/profile/__tests__/profile.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileService } from '../profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: jest.Mocked<PrismaService>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    status: UserStatus.ONLINE,
    lastSeenAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get(ProfileService);
    prisma = module.get(PrismaService);
  });

  describe('getUserProfile', () => {
    it('should return user profile when user exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserProfile('user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
          lastSeenAt: true,
        },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile('invalid-id'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update displayName successfully', async () => {
      const updatedUser = { ...mockUser, displayName: 'New Name' };
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile('user-1', { displayName: 'New Name' });

      expect(result.displayName).toBe('New Name');
    });

    it('should reject displayName shorter than 1 character', async () => {
      await expect(service.updateProfile('user-1', { displayName: '' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should reject displayName longer than 64 characters', async () => {
      const longName = 'a'.repeat(65);
      await expect(service.updateProfile('user-1', { displayName: longName }))
        .rejects.toThrow(BadRequestException);
    });

    it('should update status successfully', async () => {
      const updatedUser = { ...mockUser, status: UserStatus.AWAY };
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile('user-1', { status: UserStatus.AWAY });

      expect(result.status).toBe(UserStatus.AWAY);
    });

    it('should handle unique constraint violation', async () => {
      const error = { code: 'P2002' };
      prisma.user.update.mockRejectedValue(error);

      await expect(service.updateProfile('user-1', { displayName: 'Duplicate' }))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('updateAvatar', () => {
    it('should update avatarUrl successfully', async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await service.updateAvatar('user-1', 'https://example.com/new-avatar.jpg');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: 'https://example.com/new-avatar.jpg' },
      });
    });
  });
});
```

**Step 2: 运行测试确认失败**

Run: `cd apps/server && pnpm test -- --testPathPattern=profile.service`
Expected: FAIL with "Cannot find module '../profile.service'"

**Step 3: Commit**

```bash
git add apps/server/src/profile/__tests__/
git commit -m "test(profile): add ProfileService unit tests"
```

---

## Task 3: 实现 ProfileService

**Files:**
- Create: `apps/server/src/profile/profile.service.ts`

**Step 1: 实现 ProfileService**

```typescript
// apps/server/src/profile/profile.service.ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        lastSeenAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // 验证 displayName 长度（1-64 字符）
    if (dto.displayName !== undefined) {
      if (dto.displayName.length < 1 || dto.displayName.length > 64) {
        throw new BadRequestException('昵称长度必须在 1-64 个字符之间');
      }
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
        },
      });

      return updated;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('用户名已被占用');
      }
      throw error;
    }
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
  }
}
```

**Step 2: 运行测试确认通过**

Run: `cd apps/server && pnpm test -- --testPathPattern=profile.service`
Expected: PASS - 所有测试通过

**Step 3: Commit**

```bash
git add apps/server/src/profile/profile.service.ts
git commit -m "feat(profile): implement ProfileService with validation"
```

---

## Task 4: 实现 ProfileController

**Files:**
- Create: `apps/server/src/profile/profile.controller.ts`
- Create: `apps/server/src/profile/__tests__/profile.controller.spec.ts`

**Step 1: 创建 Controller 测试**

```typescript
// apps/server/src/profile/__tests__/profile.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from '../profile.controller';
import { ProfileService } from '../profile.service';
import { UploadService } from '../../upload/upload.service';
import { BadRequestException } from '@nestjs/common';

describe('ProfileController', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<ProfileService>;
  let uploadService: jest.Mocked<UploadService>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    status: 'ONLINE',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        {
          provide: ProfileService,
          useValue: {
            getUserProfile: jest.fn(),
            updateProfile: jest.fn(),
            updateAvatar: jest.fn(),
          },
        },
        {
          provide: UploadService,
          useValue: {
            uploadImage: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ProfileController);
    profileService = module.get(ProfileService);
    uploadService = module.get(UploadService);
  });

  describe('getCurrentUser', () => {
    it('should return current user profile', async () => {
      profileService.getUserProfile.mockResolvedValue(mockUser as any);

      const result = await controller.getCurrentUser('user-1');

      expect(result).toEqual(mockUser);
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const dto = { displayName: 'New Name' };
      const updatedUser = { ...mockUser, displayName: 'New Name' };
      profileService.updateProfile.mockResolvedValue(updatedUser as any);

      const result = await controller.updateProfile('user-1', dto as any);

      expect(result.displayName).toBe('New Name');
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar and return URL', async () => {
      const file = {
        buffer: Buffer.from('test'),
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File;

      uploadService.uploadImage.mockResolvedValue('https://example.com/avatar.jpg');

      const result = await controller.uploadAvatar('user-1', file);

      expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(profileService.updateAvatar).toHaveBeenCalledWith(
        'user-1',
        'https://example.com/avatar.jpg',
      );
    });
  });
});
```

**Step 2: 实现 Controller**

```typescript
// apps/server/src/profile/profile.controller.ts
import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UploadService } from '../upload/upload.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('me')
  async getCurrentUser(@CurrentUser('userId') userId: string) {
    return this.profileService.getUserProfile(userId);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(userId, dto);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const avatarUrl = await this.uploadService.uploadImage(file, 'avatars');
    await this.profileService.updateAvatar(userId, avatarUrl);
    return { avatarUrl };
  }
}
```

**Step 3: 运行测试确认通过**

Run: `cd apps/server && pnpm test -- --testPathPattern=profile.controller`
Expected: PASS - 所有测试通过

**Step 4: Commit**

```bash
git add apps/server/src/profile/
git commit -m "feat(profile): implement ProfileController with JWT auth"
```

---

## Task 5: 注册 ProfileModule 到 AppModule

**Files:**
- Modify: `apps/server/src/app.module.ts`

**Step 1: 导入 ProfileModule**

找到 `apps/server/src/app.module.ts`，在 imports 数组中添加 `ProfileModule`：

```typescript
// apps/server/src/app.module.ts
import { Module } from '@nestjs/common';
import { ProfileModule } from './profile/profile.module';
// ... 其他 imports

@Module({
  imports: [
    // ... 现有模块
    ProfileModule,
  ],
  // ...
})
export class AppModule {}
```

**Step 2: 验证编译成功**

Run: `cd apps/server && pnpm build`
Expected: 编译成功，无错误

**Step 3: Commit**

```bash
git add apps/server/src/app.module.ts
git commit -m "feat(app): register ProfileModule"
```

---

## Task 6: 创建 UploadModule 和 UploadService 测试

**Files:**
- Create: `apps/server/src/upload/upload.module.ts`
- Create: `apps/server/src/upload/__tests__/upload.service.spec.ts`

**Step 1: 创建 UploadModule**

```typescript
// apps/server/src/upload/upload.module.ts
import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';

@Module({
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
```

**Step 2: 创建 UploadService 测试**

```typescript
// apps/server/src/upload/__tests__/upload.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UploadService } from '../upload.service';
import { BadRequestException } from '@nestjs/common';

describe('UploadService', () => {
  let service: UploadService;
  let mockMinioClient: any;

  beforeEach(async () => {
    mockMinioClient = {
      putObject: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: 'MINIO_CLIENT',
          useValue: mockMinioClient,
        },
      ],
    }).compile();

    service = module.get(UploadService);
  });

  describe('uploadImage', () => {
    it('should accept valid JPG image', async () => {
      const file = {
        buffer: Buffer.from('fake image data'),
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File;

      const result = await service.uploadImage(file, 'avatars');

      expect(result).toMatch(/^http:\/\/.*\.jpg$/);
      expect(mockMinioClient.putObject).toHaveBeenCalled();
    });

    it('should accept valid PNG image', async () => {
      const file = {
        buffer: Buffer.from('fake image data'),
        mimetype: 'image/png',
        size: 1024,
      } as Express.Multer.File;

      const result = await service.uploadImage(file, 'avatars');

      expect(result).toMatch(/^http:\/\/.*\.jpg$/);
    });

    it('should reject GIF images', async () => {
      const file = {
        buffer: Buffer.from('fake image data'),
        mimetype: 'image/gif',
        size: 1024,
      } as Express.Multer.File;

      await expect(service.uploadImage(file, 'avatars'))
        .rejects.toThrow(BadRequestException);
    });

    it('should reject files larger than 5MB', async () => {
      const file = {
        buffer: Buffer.from('fake image data'),
        mimetype: 'image/jpeg',
        size: 6 * 1024 * 1024, // 6MB
      } as Express.Multer.File;

      await expect(service.uploadImage(file, 'avatars'))
        .rejects.toThrow(BadRequestException);
    });
  });
});
```

**Step 3: 运行测试确认失败**

Run: `cd apps/server && pnpm test -- --testPathPattern=upload.service`
Expected: FAIL with "Cannot find module '../upload.service'"

**Step 4: Commit**

```bash
git add apps/server/src/upload/
git commit -m "test(upload): add UploadService unit tests"
```

---

## Task 7: 实现 UploadService

**Files:**
- Create: `apps/server/src/upload/upload.service.ts`

**Step 1: 安装依赖**

Run: `cd apps/server && pnpm add sharp uuid && pnpm add -D @types/uuid`
Expected: 安装成功

**Step 2: 实现 UploadService**

```typescript
// apps/server/src/upload/upload.service.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import * as sharp from 'sharp';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(
    @Inject('MINIO_CLIENT') private readonly minioClient: Minio.Client,
    private readonly configService: ConfigService,
  ) {}

  async uploadImage(file: Express.Multer.File, folder: string): Promise<string> {
    // 1. 验证文件类型
    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('只支持 JPG、PNG、WebP 格式的图片');
    }

    // 2. 验证文件大小
    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException('图片大小不能超过 5MB');
    }

    try {
      // 3. 使用 Sharp 压缩图片
      const compressedBuffer = await sharp(file.buffer)
        .resize(500, 500, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();

      // 4. 生成唯一文件名
      const fileName = `${folder}/${uuid()}.jpg`;

      // 5. 上传到 MinIO
      await this.minioClient.putObject(
        this.configService.get<string>('MINIO_BUCKET')!,
        fileName,
        compressedBuffer,
        {
          'Content-Type': 'image/jpeg',
        },
      );

      // 6. 返回公开访问 URL
      const publicUrl = this.configService.get<string>('MINIO_PUBLIC_URL')!;
      return `${publicUrl}/${fileName}`;
    } catch (error) {
      console.error('Image upload failed:', error);
      throw new BadRequestException('图片上传失败，请重试');
    }
  }
}
```

**Step 3: 运行测试确认通过**

Run: `cd apps/server && pnpm test -- --testPathPattern=upload.service`
Expected: PASS - 所有测试通过

**Step 4: Commit**

```bash
git add apps/server/src/upload/upload.service.ts
git commit -m "feat(upload): implement UploadService with Sharp image processing"
```

---

## Task 8: 配置 MinIO 客户端提供者

**Files:**
- Modify: `apps/server/src/upload/upload.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Step 1: 更新 UploadModule**

```typescript
// apps/server/src/upload/upload.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { UploadService } from './upload.service';

@Global()
@Module({
  providers: [
    {
      provide: 'MINIO_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new Minio.Client({
          endPoint: configService.get<string>('MINIO_ENDPOINT')!,
          port: configService.get<number>('MINIO_PORT')!,
          useSSL: configService.get<boolean>('MINIO_USE_SSL') || false,
          accessKey: configService.get<string>('MINIO_ACCESS_KEY')!,
          secretKey: configService.get<string>('MINIO_SECRET_KEY')!,
        });
      },
      inject: [ConfigService],
    },
    UploadService,
  ],
  exports: [UploadService, 'MINIO_CLIENT'],
})
export class UploadModule {}
```

**Step 2: 在 AppModule 中导入 UploadModule**

```typescript
// apps/server/src/app.module.ts
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    // ... 现有模块
    UploadModule,
    ProfileModule,
  ],
})
export class AppModule {}
```

**Step 3: 验证编译成功**

Run: `cd apps/server && pnpm build`
Expected: 编译成功

**Step 4: Commit**

```bash
git add apps/server/src/upload/upload.module.ts apps/server/src/app.module.ts
git commit -m "feat(upload): configure MinIO client provider"
```

---

## Task 9: 添加设备删除功能到 DevicesController

**Files:**
- Modify: `apps/server/src/devices/devices.controller.ts`
- Create: `apps/server/src/devices/__tests__/devices.controller.spec.ts` (如果不存在)

**Step 1: 添加删除设备测试**

```typescript
// apps/server/src/devices/__tests__/devices.controller.spec.ts
describe('DevicesController', () => {
  describe('deleteDevice', () => {
    it('should delete device owned by current user', async () => {
      // 测试实现
    });

    it('should reject deleting device owned by another user', async () => {
      // 测试实现
    });
  });
});
```

**Step 2: 添加删除端点**

```typescript
// apps/server/src/devices/devices.controller.ts
@Delete(':deviceId')
async deleteDevice(
  @CurrentUser('userId') userId: string,
  @Param('deviceId') deviceId: string,
) {
  return this.devicesService.deleteDevice(userId, deviceId);
}
```

**Step 3: 实现删除逻辑**

```typescript
// apps/server/src/devices/devices.service.ts
async deleteDevice(userId: string, deviceId: string) {
  const device = await this.prisma.device.findUnique({
    where: { id: deviceId },
  });

  if (!device) {
    throw new NotFoundException('设备不存在');
  }

  if (device.userId !== userId) {
    throw new ForbiddenException('无权删除此设备');
  }

  await this.prisma.device.delete({
    where: { id: deviceId },
  });

  return { message: '设备已删除' };
}
```

**Step 4: Commit**

```bash
git add apps/server/src/devices/
git commit -m "feat(devices): add device deletion endpoint with ownership check"
```

---

## Task 10: 运行完整后端测试

**Step 1: 运行所有测试**

Run: `cd apps/server && pnpm test`
Expected: 所有测试通过

**Step 2: 运行 lint 检查**

Run: `cd apps/server && pnpm lint`
Expected: 无错误

**Step 3: 验证 API 端点**

Run: `cd apps/server && pnpm dev:server`
然后测试：

```bash
# 获取当前用户
curl -H "Authorization: Bearer <token>" http://localhost:3008/api/v1/profile/me

# 更新昵称
curl -X PATCH -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"新昵称"}' \
  http://localhost:3008/api/v1/profile/me
```

**Step 4: Commit**

```bash
git add .
git commit -m "test: verify all backend Profile APIs working"
```

---

## Task 11: 创建 Flutter Profile 页面

**Files:**
- Create: `apps/mobile/lib/features/profile/pages/profile_page.dart`
- Create: `apps/mobile/lib/features/profile/providers/profile_provider.dart`
- Create: `apps/mobile/lib/features/profile/models/user_profile.dart`

**Step 1: 创建 UserProfile 模型**

```dart
// apps/mobile/lib/features/profile/models/user_profile.dart
import 'package:json_annotation/json_annotation.dart';

part 'user_profile.g.dart';

@JsonSerializable()
class UserProfile {
  final String id;
  final String email;
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String status;
  final DateTime? lastSeenAt;

  UserProfile({
    required this.id,
    required this.email,
    required this.username,
    required this.displayName,
    this.avatarUrl,
    required this.status,
    this.lastSeenAt,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) =>
      _$UserProfileFromJson(json);
  Map<String, dynamic> toJson() => _$UserProfileToJson(this);

  UserProfile copyWith({
    String? displayName,
    String? avatarUrl,
    String? status,
  }) {
    return UserProfile(
      id: id,
      email: email,
      username: username,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      status: status ?? this.status,
      lastSeenAt: lastSeenAt,
    );
  }
}
```

**Step 2: 运行代码生成**

Run: `cd apps/mobile && flutter pub run build_runner build`
Expected: 生成 `user_profile.g.dart`

**Step 3: Commit**

```bash
git add apps/mobile/lib/features/profile/models/
git commit -m "feat(mobile): add UserProfile model"
```

---

## Task 12: 实现 Flutter ProfileProvider

**Files:**
- Create: `apps/mobile/lib/features/profile/providers/profile_provider.dart`

**Step 1: 创建 ProfileProvider**

```dart
// apps/mobile/lib/features/profile/providers/profile_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../models/user_profile.dart';
import '../../device/models/device.dart';

enum ProfileStatus { initial, loading, success, error }

class ProfileState {
  final UserProfile? profile;
  final List<Device> devices;
  final ProfileStatus status;
  final String? error;

  const ProfileState({
    this.profile,
    this.devices = const [],
    this.status = ProfileStatus.initial,
    this.error,
  });

  ProfileState copyWith({
    UserProfile? profile,
    List<Device>? devices,
    ProfileStatus? status,
    String? error,
  }) {
    return ProfileState(
      profile: profile ?? this.profile,
      devices: devices ?? this.devices,
      status: status ?? this.status,
      error: error,
    );
  }
}

class ProfileNotifier extends StateNotifier<ProfileState> {
  final Ref _ref;

  ProfileNotifier(this._ref) : super(const ProfileState());

  Future<void> fetchProfile() async {
    state = state.copyWith(status: ProfileStatus.loading);

    try {
      final dio = _ref.read(dioProvider);

      final profileResponse = await dio.get('/api/v1/profile/me');
      final profile = UserProfile.fromJson(profileResponse.data);

      final devicesResponse = await dio.get('/api/v1/devices');
      final devices = (devicesResponse.data as List)
          .map((json) => Device.fromJson(json))
          .toList();

      state = ProfileState(
        profile: profile,
        devices: devices,
        status: ProfileStatus.success,
      );
    } catch (e) {
      state = state.copyWith(
        status: ProfileStatus.error,
        error: e.toString(),
      );
    }
  }

  Future<void> updateDisplayName(String newName) async {
    final oldName = state.profile?.displayName;

    // 乐观更新
    state = state.copyWith(
      profile: state.profile?.copyWith(displayName: newName),
    );

    try {
      final dio = _ref.read(dioProvider);
      await dio.patch('/api/v1/profile/me', data: {'displayName': newName});

      // TODO: 显示 SnackBar
    } catch (e) {
      // 回滚
      state = state.copyWith(
        profile: state.profile?.copyWith(displayName: oldName),
      );

      // TODO: 显示错误对话框
    }
  }

  Future<void> updateStatus(String newStatus) async {
    state = state.copyWith(
      profile: state.profile?.copyWith(status: newStatus),
    );

    try {
      final dio = _ref.read(dioProvider);
      await dio.patch('/api/v1/profile/me', data: {'status': newStatus});
    } catch (e) {
      // TODO: 错误处理
    }
  }

  Future<void> deleteDevice(String deviceId) async {
    state = state.copyWith(
      devices: state.devices.where((d) => d.id != deviceId).toList(),
    );

    try {
      final dio = _ref.read(dioProvider);
      await dio.delete('/api/v1/devices/$deviceId');
    } catch (e) {
      // TODO: 刷新设备列表
    }
  }
}

final profileProvider =
    StateNotifierProvider<ProfileNotifier, ProfileState>((ref) {
  return ProfileNotifier(ref);
});
```

**Step 2: Commit**

```bash
git add apps/mobile/lib/features/profile/providers/
git commit -m "feat(mobile): implement ProfileProvider with optimistic updates"
```

---

## Task 13: 实现 Flutter Profile 页面 UI

**Files:**
- Create: `apps/mobile/lib/features/profile/pages/profile_page.dart`
- Create: `apps/mobile/lib/features/profile/widgets/profile_header.dart`
- Create: `apps/mobile/lib/features/profile/widgets/status_selector.dart`

**Step 1: 创建 Profile 页面**

```dart
// apps/mobile/lib/features/profile/pages/profile_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/profile_provider.dart';
import '../widgets/profile_header.dart';
import '../widgets/status_selector.dart';

class ProfilePage extends ConsumerStatefulWidget {
  @override
  ConsumerState<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends ConsumerState<ProfilePage> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(profileProvider.notifier).fetchProfile());
  }

  @override
  Widget build(BuildContext context) {
    final profileState = ref.watch(profileProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text('个人资料'),
      ),
      body: profileState.status == ProfileStatus.loading
          ? Center(child: CircularProgressIndicator())
          : profileState.profile == null
              ? Center(child: Text('加载失败'))
              : ListView(
                  children: [
                    ProfileHeader(
                      avatarUrl: profileState.profile!.avatarUrl,
                      displayName: profileState.profile!.displayName,
                      status: profileState.profile!.status,
                      onAvatarTap: _showAvatarOptions,
                    ),
                    SizedBox(height: 8),
                    _buildInfoCard(profileState.profile!),
                    SizedBox(height: 8),
                    StatusSelector(
                      currentStatus: profileState.profile!.status,
                      onStatusChanged: (status) {
                        ref.read(profileProvider.notifier).updateStatus(status);
                      },
                    ),
                    SizedBox(height: 24),
                    _buildLogoutButton(),
                  ],
                ),
    );
  }

  Widget _buildInfoCard(UserProfile profile) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: Icon(Icons.person),
            title: Text('昵称'),
            subtitle: Text(profile.displayName),
            onTap: () => _showEditDisplayNameDialog(profile.displayName),
          ),
          ListTile(
            leading: Icon(Icons.alternate_email),
            title: Text('用户名'),
            subtitle: Text('@${profile.username}'),
          ),
          ListTile(
            leading: Icon(Icons.email),
            title: Text('邮箱'),
            subtitle: Text(profile.email),
          ),
        ],
      ),
    );
  }

  void _showEditDisplayNameDialog(String currentName) {
    final controller = TextEditingController(text: currentName);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('编辑昵称'),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(hintText: '请输入昵称'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('取消'),
          ),
          TextButton(
            onPressed: () {
              ref.read(profileProvider.notifier).updateDisplayName(controller.text);
              Navigator.pop(context);
            },
            child: Text('保存'),
          ),
        ],
      ),
    );
  }

  void _showAvatarOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(Icons.camera_alt),
            title: Text('拍照'),
            onTap: () {
              Navigator.pop(context);
              // TODO: 实现拍照
            },
          ),
          ListTile(
            leading: Icon(Icons.photo_library),
            title: Text('从相册选择'),
            onTap: () {
              Navigator.pop(context);
              // TODO: 实现相册选择
            },
          ),
        ],
      ),
    );
  }

  Widget _buildLogoutButton() {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 16),
      child: ElevatedButton(
        onPressed: () => _showLogoutConfirmation(),
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.red,
          foregroundColor: Colors.white,
        ),
        child: Text('退出登录'),
      ),
    );
  }

  void _showLogoutConfirmation() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('退出登录'),
        content: Text('确定要退出登录吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('取消'),
          ),
          TextButton(
            onPressed: () {
              // TODO: 调用登出逻辑
              Navigator.pop(context);
            },
            child: Text('确定'),
          ),
        ],
      ),
    );
  }
}
```

**Step 2: 创建辅助 widgets**

```dart
// apps/mobile/lib/features/profile/widgets/profile_header.dart
import 'package:flutter/material.dart';

class ProfileHeader extends StatelessWidget {
  final String? avatarUrl;
  final String displayName;
  final String status;
  final VoidCallback onAvatarTap;

  const ProfileHeader({
    required this.avatarUrl,
    required this.displayName,
    required this.status,
    required this.onAvatarTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(24),
      child: Column(
        children: [
          GestureDetector(
            onTap: onAvatarTap,
            child: Stack(
              children: [
                CircleAvatar(
                  radius: 50,
                  backgroundImage: avatarUrl != null
                      ? NetworkImage(avatarUrl!)
                      : null,
                  child: avatarUrl == null
                      ? Icon(Icons.person, size: 50)
                      : null,
                ),
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: CircleAvatar(
                    radius: 18,
                    backgroundColor: Theme.of(context).primaryColor,
                    child: Icon(Icons.camera_alt, size: 18, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 16),
          Text(
            displayName,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
```

```dart
// apps/mobile/lib/features/profile/widgets/status_selector.dart
import 'package:flutter/material.dart';

class StatusSelector extends StatelessWidget {
  final String currentStatus;
  final Function(String) onStatusChanged;

  const StatusSelector({
    required this.currentStatus,
    required this.onStatusChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        children: [
          ListTile(
            title: Text('状态', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          RadioListTile<String>(
            title: Text('在线'),
            secondary: Icon(Icons.circle, color: Colors.green),
            value: 'ONLINE',
            groupValue: currentStatus,
            onChanged: (value) => onStatusChanged(value!),
          ),
          RadioListTile<String>(
            title: Text('离开'),
            secondary: Icon(Icons.trip_origin, color: Colors.orange),
            value: 'AWAY',
            groupValue: currentStatus,
            onChanged: (value) => onStatusChanged(value!),
          ),
          RadioListTile<String>(
            title: Text('忙碌'),
            secondary: Icon(Icons.block, color: Colors.red),
            value: 'BUSY',
            groupValue: currentStatus,
            onChanged: (value) => onStatusChanged(value!),
          ),
          RadioListTile<String>(
            title: Text('隐身'),
            secondary: Icon(Icons.circle_outlined, color: Colors.grey),
            value: 'OFFLINE',
            groupValue: currentStatus,
            onChanged: (value) => onStatusChanged(value!),
          ),
        ],
      ),
    );
  }
}
```

**Step 3: Commit**

```bash
git add apps/mobile/lib/features/profile/
git commit -m "feat(mobile): implement Profile page UI referencing WhatsApp"
```

---

## Task 14: 添加 Profile 页面到导航

**Files:**
- Modify: `apps/mobile/lib/features/shared/widgets/bottom_nav.dart`

**Step 1: 添加 Profile 导航项**

```dart
// 在底部导航栏添加 Profile 入口
BottomNavigationBarItem(
  icon: Icon(Icons.person),
  label: '我',
),
```

**Step 2: Commit**

```bash
git add apps/mobile/lib/features/shared/widgets/bottom_nav.dart
git commit -m "feat(mobile): add Profile to bottom navigation"
```

---

## Task 15: 创建 Desktop Profile 面板

**Files:**
- Create: `apps/desktop/src/renderer/components/profile/ProfilePanel.tsx`
- Create: `apps/desktop/src/renderer/hooks/useProfile.ts`

**Step 1: 创建 useProfile hook**

```tsx
// apps/desktop/src/renderer/hooks/useProfile.ts
import { useState, useCallback } from 'react';
import { apiClient } from '../lib/apiClient';

interface UserProfile {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: string;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/v1/profile/me');
      setProfile(response.data);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateDisplayName = async (newName: string) => {
    await apiClient.patch('/api/v1/profile/me', { displayName: newName });
    setProfile(prev => prev ? { ...prev, displayName: newName } : null);
  };

  const updateStatus = async (newStatus: string) => {
    await apiClient.patch('/api/v1/profile/me', { status: newStatus });
    setProfile(prev => prev ? { ...prev, status: newStatus } : null);
  };

  const uploadAvatar = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post('/api/v1/profile/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    setProfile(prev =>
      prev ? { ...prev, avatarUrl: response.data.avatarUrl } : null
    );
  };

  return {
    profile,
    loading,
    fetchProfile,
    updateDisplayName,
    updateStatus,
    uploadAvatar,
  };
}
```

**Step 2: 创建 ProfilePanel 组件**

```tsx
// apps/desktop/src/renderer/components/profile/ProfilePanel.tsx
import React, { useEffect } from 'react';
import { useProfile } from '../../hooks/useProfile';

export function ProfilePanel() {
  const { profile, loading, fetchProfile, updateDisplayName, updateStatus } = useProfile();

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!profile) {
    return <div>Failed to load profile</div>;
  }

  return (
    <div className="profile-panel">
      <div className="profile-header">
        <div className="avatar">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="Avatar" />
          ) : (
            <div className="avatar-placeholder">
              {profile.displayName[0].toUpperCase()}
            </div>
          )}
        </div>
        <h2>{profile.displayName}</h2>
        <span className={`status-badge status-${profile.status.toLowerCase()}`}>
          {profile.status}
        </span>
      </div>

      <div className="profile-info">
        <div className="info-card">
          <h3>账号信息</h3>
          <div className="info-item">
            <label>昵称</label>
            <input
              type="text"
              value={profile.displayName}
              onChange={(e) => updateDisplayName(e.target.value)}
              onBlur={() => updateDisplayName(profile.displayName)}
            />
          </div>
          <div className="info-item">
            <label>用户名</label>
            <span>@{profile.username}</span>
          </div>
          <div className="info-item">
            <label>邮箱</label>
            <span>{profile.email}</span>
          </div>
        </div>

        <div className="info-card">
          <h3>状态</h3>
          <div className="status-selector">
            {['ONLINE', 'AWAY', 'BUSY', 'OFFLINE'].map(status => (
              <label key={status}>
                <input
                  type="radio"
                  name="status"
                  value={status}
                  checked={profile.status === status}
                  onChange={() => updateStatus(status)}
                />
                {status}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/profile/ apps/desktop/src/renderer/hooks/useProfile.ts
git commit -m "feat(desktop): implement ProfilePanel referencing Telegram Desktop"
```

---

## Task 16: 集成 Desktop Profile 面板到 Settings

**Files:**
- Modify: `apps/desktop/src/renderer/pages/Dashboard.tsx` (或 Settings 页面)

**Step 1: 添加 Profile 入口**

```tsx
import { ProfilePanel } from '../components/profile/ProfilePanel';

// 在设置或侧边栏中添加
<Tab label="个人资料">
  <ProfilePanel />
</Tab>
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/pages/
git commit -m "feat(desktop): integrate ProfilePanel into Dashboard"
```

---

## Task 17: 实现 Flutter 登出功能

**Files:**
- Modify: `apps/mobile/lib/features/profile/pages/profile_page.dart`

**Step 1: 调用 AuthProvider 的 logout**

```dart
void _showLogoutConfirmation() {
  showDialog(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('退出登录'),
      content: Text('确定要退出登录吗？'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('取消'),
        ),
        TextButton(
          onPressed: () async {
            Navigator.pop(context);
            await ref.read(authProvider.notifier).logout();
            // Navigator 会自动跳转到登录页，因为 authState 变为 unauthenticated
          },
          child: Text('确定'),
        ),
      ],
    ),
  );
}
```

**Step 2: Commit**

```bash
git add apps/mobile/lib/features/profile/pages/profile_page.dart
git commit -m "feat(mobile): implement logout functionality in Profile page"
```

---

## Task 18: 实现 Desktop 登出功能

**Files:**
- Modify: `apps/desktop/src/renderer/components/profile/ProfilePanel.tsx`

**Step 1: 添加登出按钮**

```tsx
const handleLogout = () => {
  // 清除 token
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');

  // 断开 WebSocket
  // socket.disconnect();

  // 跳转到登录页
  window.location.href = '/login';
};

// 在 ProfilePanel 中添加
<Button variant="danger" onClick={handleLogout}>
  退出登录
</Button>
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/profile/ProfilePanel.tsx
git commit -m "feat(desktop): implement logout functionality in ProfilePanel"
```

---

## Task 19: E2E 测试验证

**Step 1: 手动测试 Flutter**

1. 启动后端：`cd apps/server && pnpm dev:server`
2. 启动 Flutter：`cd apps/mobile && flutter run`
3. 测试流程：
   - 登录
   - 进入 Profile 页面
   - 修改昵称
   - 修改状态
   - 执行登出

**Step 2: 手动测试 Desktop**

1. 启动 Desktop：`cd apps/desktop && pnpm dev:desktop`
2. 测试相同流程

**Step 3: Commit**

```bash
git add .
git commit -m "test: verify Profile functionality works across all platforms"
```

---

## Task 20: 最终代码审查和文档更新

**Files:**
- Update: `CLAUDE.md`
- Update: `docs/plans/2026-03-01-phase8-implementation.md`

**Step 1: 更新 CLAUDE.md**

在 Sprint 3 状态中添加：

```markdown
- **Phase 8** ✅ — Profile 页面（头像上传 + 设备管理 + 状态管理）
```

**Step 2: 运行最终检查**

```bash
# 后端测试
cd apps/server && pnpm test

# Lint 检查
pnpm lint

# Type 检查
pnpm type-check
```

**Step 3: 最终提交**

```bash
git add .
git commit -m "docs: mark Phase 8 as completed"
```

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-03-01-phase8-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
