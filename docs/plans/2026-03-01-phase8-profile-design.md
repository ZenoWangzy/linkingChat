# Phase 8 Profile 页面设计文档

**日期**: 2026-03-01
**方案**: 模块化分层架构（方案 A）
**设计参考**: Telegram / WhatsApp / WeChat

## 概述

Phase 8 实现用户个人资料页面，包含 Server API + Flutter Mobile + Electron Desktop 三端实现。设计遵循"无脑抄成熟产品"策略，参考 Telegram/WhatsApp/WeChat 的 UI/UX 模式。

## 需求确认

### 功能需求
- ✅ **头像上传**：支持文件上传（MinIO + Sharp 图片处理）
- ✅ **设备管理**：显示设备列表 + 删除设备功能
- ✅ **状态管理**：允许用户手动设置（ONLINE, AWAY, BUSY, OFFLINE）
- ✅ **跨端一致**：Flutter 和 Desktop 功能、UI、交互完全一致

### 设计原则
- 🎯 **简洁至上**：白色背景 + 极简图标 + 清晰层级
- 🎯 **卡片式布局**：信息分组在圆角卡片中
- 🎯 **底部操作**：主要操作按钮在底部
- 🎯 **渐进式编辑**：点击字段直接编辑，无需额外页面

## 后端架构设计

### 模块结构

```
apps/server/src/
├── profile/                          # 新建模块
│   ├── profile.module.ts
│   ├── profile.controller.ts         # GET/PATCH /me, 设备管理
│   ├── profile.service.ts
│   ├── dto/
│   │   ├── update-profile.dto.ts     # displayName, status, avatarUrl
│   │   └── upload-avatar.dto.ts
│   └── __tests__/
│       ├── profile.service.spec.ts
│       └── profile.controller.spec.ts
│
├── upload/                           # 新建通用上传服务
│   ├── upload.module.ts
│   ├── upload.service.ts             # MinIO 集成 + 图片处理
│   └── __tests__/
│       └── upload.service.spec.ts
```

### API 端点设计

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/profile/me` | 获取当前用户详情 |
| PATCH | `/api/v1/profile/me` | 更新用户信息 |
| POST | `/api/v1/profile/avatar` | 上传头像 |
| GET | `/api/v1/devices` | 获取当前用户设备列表（已存在） |
| DELETE | `/api/v1/devices/:deviceId` | 删除设备（新增） |

### 关键代码示例

#### ProfileController

```typescript
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

#### UploadService（MinIO + Sharp）

```typescript
@Injectable()
export class UploadService {
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(
    @Inject('MINIO_CLIENT') private minioClient: Minio.Client,
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

    // 3. 使用 Sharp 压缩到 500x500px
    const compressedBuffer = await sharp(file.buffer)
      .resize(500, 500, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();

    // 4. 上传到 MinIO
    const fileName = `${folder}/${uuid()}.jpg`;
    await this.minioClient.putObject(
      process.env.MINIO_BUCKET!,
      fileName,
      compressedBuffer,
    );

    // 5. 返回公开访问 URL
    return `${process.env.MINIO_PUBLIC_URL}/${fileName}`;
  }
}
```

## 前端设计

### Flutter Profile 页面

**页面结构**（参考 WhatsApp Settings）：

```dart
// lib/features/profile/pages/profile_page.dart
class ProfilePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('个人资料'),
        actions: [
          IconButton(icon: Icon(Icons.edit), onPressed: ...),
        ],
      ),
      body: ListView(
        children: [
          // 1. 头像 + 基本信息（参考 WhatsApp）
          _ProfileHeader(
            avatarUrl: user.avatarUrl,
            displayName: user.displayName,
            status: user.status,
            onAvatarTap: _showAvatarOptions,
          ),

          SizedBox(height: 8),

          // 2. 详细信息卡片（参考 Telegram）
          _InfoCard(
            title: '账号信息',
            items: [
              _InfoItem(icon: Icons.person, label: '昵称', value: user.displayName),
              _InfoItem(icon: Icons.alternate_email, label: '用户名', value: '@${user.username}'),
              _InfoItem(icon: Icons.email, label: '邮箱', value: user.email),
            ],
          ),

          SizedBox(height: 8),

          // 3. 状态选择（参考 WhatsApp "About"）
          _StatusSelector(
            currentStatus: user.status,
            onStatusChanged: _updateStatus,
          ),

          SizedBox(height: 8),

          // 4. 设备列表（参考 Telegram Devices）
          _DeviceList(
            devices: devices,
            onDeviceDelete: _deleteDevice,
          ),

          SizedBox(height: 24),

          // 5. 登出按钮（参考 WeChat "退出登录"）
          _LogoutButton(onPressed: _logout),
        ],
      ),
    );
  }
}
```

### Desktop Profile 面板

**布局策略**（参考 Telegram Desktop Settings）：

```tsx
// apps/desktop/src/renderer/components/profile/ProfilePanel.tsx
export function ProfilePanel() {
  return (
    <div className="profile-panel">
      {/* 左侧：头像 + 昵称 */}
      <div className="profile-sidebar">
        <AvatarUpload
          size={120}
          avatarUrl={user.avatarUrl}
          onUpload={handleAvatarUpload}
        />
        <h2>{user.displayName}</h2>
        <StatusBadge status={user.status} />
      </div>

      {/* 右侧：详细信息 */}
      <div className="profile-content">
        <Card title="账号信息">
          <EditableField label="昵称" value={user.displayName} onSave={updateDisplayName} />
          <ReadOnlyField label="用户名" value={`@${user.username}`} />
          <ReadOnlyField label="邮箱" value={user.email} />
        </Card>

        <Card title="状态">
          <StatusSelector value={user.status} onChange={updateStatus} />
        </Card>

        <Card title="已登录设备">
          <DeviceList devices={devices} onDelete={deleteDevice} />
        </Card>

        <Button variant="danger" onClick={handleLogout}>
          退出登录
        </Button>
      </div>
    </div>
  );
}
```

## 数据流设计

### Flutter 状态管理（Riverpod）

```dart
// lib/features/profile/providers/profile_provider.dart
class ProfileState {
  final UserProfile? profile;
  final List<Device> devices;
  final bool isLoading;
  final String? error;
}

class ProfileNotifier extends StateNotifier<ProfileState> {
  // 获取用户详情
  Future<void> fetchProfile() async { ... }

  // 更新昵称（乐观更新 + 回滚）
  Future<void> updateDisplayName(String newName) async {
    final oldName = state.profile?.displayName;
    state = state.copyWith(
      profile: state.profile?.copyWith(displayName: newName),
    );

    try {
      await dio.patch('/api/v1/profile/me', data: {'displayName': newName});
      _showSnackBar('昵称已更新');
    } catch (e) {
      state = state.copyWith(
        profile: state.profile?.copyWith(displayName: oldName),
      );
      _showErrorDialog('更新失败，请重试');
    }
  }

  // 更新状态
  Future<void> updateStatus(UserStatus newStatus) async { ... }

  // 上传头像
  Future<void> uploadAvatar(File imageFile) async { ... }

  // 删除设备
  Future<void> deleteDevice(String deviceId) async { ... }

  // 登出
  Future<void> logout() async { ... }
}
```

### Desktop 状态管理（React Hooks）

```tsx
// apps/desktop/src/renderer/hooks/useProfile.ts
export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);

  const updateDisplayName = async (newName: string) => {
    await apiClient.patch('/api/v1/profile/me', { displayName: newName });
    setProfile(prev => prev ? { ...prev, displayName: newName } : null);
  };

  // ... 其他方法

  return {
    profile,
    devices,
    updateDisplayName,
    updateStatus,
    uploadAvatar,
    deleteDevice,
    logout,
  };
}
```

### 跨端同步策略

通过 WebSocket 广播实现跨设备状态同步：

```dart
// Flutter 端修改后广播
socket.emit('profile:updated', {
  'userId': userId,
  'field': 'displayName',
  'value': newName,
});

// Desktop 端监听更新
socket.on('profile:updated', (data) => {
  if (data.field === 'displayName') {
    setProfile(prev => prev ? { ...prev, displayName: data.value } : null);
  }
});
```

## 错误处理

### 后端错误处理

```typescript
// ProfileService
async updateProfile(userId: string, dto: UpdateProfileDto) {
  // 验证 displayName 长度（1-64 字符）
  if (dto.displayName && (dto.displayName.length < 1 || dto.displayName.length > 64)) {
    throw new BadRequestException('昵称长度必须在 1-64 个字符之间');
  }

  try {
    return await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ConflictException('用户名已被占用');
    }
    throw error;
  }
}
```

### 前端错误处理

```dart
// 乐观更新 + 回滚策略
Future<void> updateDisplayName(String newName) async {
  final oldName = state.profile?.displayName;

  // 1. 乐观更新
  state = state.copyWith(
    profile: state.profile?.copyWith(displayName: newName),
  );

  try {
    // 2. 发送 API
    await dio.patch('/api/v1/profile/me', data: {'displayName': newName});
    _showSnackBar('昵称已更新');
  } on DioException catch (e) {
    // 3. 失败回滚
    state = state.copyWith(
      profile: state.profile?.copyWith(displayName: oldName),
    );

    final errorMessage = _parseError(e);
    _showErrorDialog(errorMessage);
  }
}
```

## 测试策略

### 后端单元测试

```typescript
describe('ProfileService', () => {
  describe('updateProfile', () => {
    it('should update displayName', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, displayName: 'New Name' });
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
  });
});
```

### UploadService 测试

```typescript
describe('UploadService', () => {
  it('should accept valid JPG image', async () => {
    const file = createMockFile({ mimetype: 'image/jpeg', size: 1024 });
    const result = await service.uploadImage(file, 'avatars');
    expect(result).toMatch(/^https:\/\/.*\.jpg$/);
  });

  it('should reject GIF images', async () => {
    const file = createMockFile({ mimetype: 'image/gif' });
    await expect(service.uploadImage(file, 'avatars'))
      .rejects.toThrow(BadRequestException);
  });

  it('should reject files larger than 5MB', async () => {
    const file = createMockFile({ size: 6 * 1024 * 1024 });
    await expect(service.uploadImage(file, 'avatars'))
      .rejects.toThrow(BadRequestException);
  });
});
```

### E2E 测试

```dart
testWidgets('User can update display name', (WidgetTester tester) async {
  await tester.pumpWidget(MyApp());
  await login(tester, 'test@example.com', 'password');

  await tester.tap(find.byIcon(Icons.person));
  await tester.pumpAndSettle();

  await tester.tap(find.text('Test User'));
  await tester.pumpAndSettle();

  await tester.enterText(find.byType(TextField), 'New Name');
  await tester.tap(find.text('保存'));
  await tester.pumpAndSettle();

  expect(find.text('New Name'), findsOneWidget);
  expect(find.text('昵称已更新'), findsOneWidget);
});
```

## 安全考虑

### 关键安全点

1. **头像上传认证**
   ```typescript
   @Post('avatar')
   @UseGuards(JwtAuthGuard)  // ✅ 确保只有登录用户可以上传
   ```

2. **文件类型验证**
   ```typescript
   if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
     throw new BadRequestException('Invalid file type');
   }
   ```

3. **文件大小限制**
   ```typescript
   if (file.size > this.MAX_FILE_SIZE) {
     throw new BadRequestException('File too large');
   }
   ```

4. **设备删除所有权验证**
   ```typescript
   const device = await this.devicesService.findById(deviceId);
   if (device.userId !== userId) {
     throw new ForbiddenException('无权删除此设备');
   }
   ```

## 实施步骤

### Step 1: 后端 API（预计 3h）
1. 创建 ProfileModule + ProfileController
2. 实现 ProfileService.getCurrentUser()
3. 实现 ProfileService.updateProfile()
4. 创建 UploadModule + UploadService
5. 编写单元测试

### Step 2: Flutter Profile 页面（预计 4h）
1. 创建 profile_page.dart
2. 实现 ProfileProvider 状态管理
3. 添加头像/昵称显示
4. 添加设备列表
5. 实现编辑功能

### Step 3: Desktop Profile 面板（预计 3h）
1. 创建 ProfilePanel.tsx
2. 集成 useProfile hook
3. 添加 UI 组件

### Step 4: 登出功能（预计 1h）
1. Flutter 登出逻辑
2. Desktop 登出逻辑
3. 清理本地存储 + 断开 WebSocket

**总计: ~11h**

## 验收标准

### API 测试
```bash
# 获取当前用户
curl -H "Authorization: Bearer <token>" http://localhost:3008/api/v1/profile/me

# 更新用户信息
curl -X PATCH -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"新昵称"}' \
  http://localhost:3008/api/v1/profile/me
```

### E2E 测试
1. ✅ 登录后进入 Profile 页面
2. ✅ 验证用户信息正确显示
3. ✅ 编辑昵称并保存
4. ✅ 验证会话列表更新
5. ✅ 执行登出
6. ✅ 验证跳转到登录页

## 参考资料

- [WhatsApp Web Settings](https://web.whatsapp.com/)
- [Telegram Desktop Profile](https://desktop.telegram.org/)
- [WeChat Mobile "我" 页面](https://weixin.qq.com/)
- [NestJS File Upload](https://docs.nestjs.com/techniques/file-upload)
- [Sharp Image Processing](https://sharp.pixelplumbing.com/)
- [MinIO Node.js SDK](https://docs.min.io/docs/javascript-client-quickstart-guide.html)
