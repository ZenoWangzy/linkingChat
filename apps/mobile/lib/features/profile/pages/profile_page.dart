// apps/mobile/lib/features/profile/pages/profile_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/profile_provider.dart';
import '../widgets/profile_avatar.dart';
import '../widgets/settings_tile.dart';

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
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Color(0xFFF5F5F5), // Telegram 灰色背景
      appBar: AppBar(
        title: Text('个人资料'),
        backgroundColor: theme.primaryColor,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: profileState.status == ProfileStatus.loading
          ? Center(child: CircularProgressIndicator())
          : profileState.profile == null
              ? _buildErrorState(profileState.error)
              : _buildContent(profileState.profile!),
    );
  }

  Widget _buildErrorState(String? error) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 64, color: Colors.grey),
          SizedBox(height: 16),
          Text('加载失败', style: TextStyle(fontSize: 18)),
          if (error != null) ...[
            SizedBox(height: 8),
            Text(error, style: TextStyle(color: Colors.grey)),
          ],
          SizedBox(height: 24),
          ElevatedButton(
            onPressed: () =>
                ref.read(profileProvider.notifier).fetchProfile(),
            child: Text('重试'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(UserProfile profile) {
    return ListView(
      padding: EdgeInsets.symmetric(vertical: 16),
      children: [
        // Telegram 风格的头部
        ProfileAvatar(
          avatarUrl: profile.avatarUrl,
          displayName: profile.displayName,
          isOnline: profile.isOnline,
          statusText: profile.statusText,
          onAvatarTap: () => _showAvatarOptions(),
        ),
        SizedBox(height: 24),

        // 账号信息卡片
        _buildSectionCard([
          SettingsTile(
            icon: Icons.person_outline,
            title: '昵称',
            subtitle: profile.displayName,
            onTap: () => _showEditNameDialog(profile.displayName),
          ),
          Divider(height: 1, indent: 56),
          SettingsTile(
            icon: Icons.alternate_email,
            title: '用户名',
            subtitle: '@${profile.username}',
            enabled: false,
          ),
          Divider(height: 1, indent: 56),
          SettingsTile(
            icon: Icons.email_outlined,
            title: '邮箱',
            subtitle: profile.email,
            enabled: false,
          ),
        ]),

        SizedBox(height: 16),

        // 状态卡片
        _buildSectionCard([
          SettingsTile(
            icon: Icons.circle,
            iconColor: _getStatusColor(profile.status),
            title: '状态',
            subtitle: profile.statusText,
            onTap: () => _showStatusSelector(profile.status),
          ),
        ]),

        SizedBox(height: 24),

        // 登出按钮
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: OutlinedButton(
            onPressed: () => _showLogoutConfirmation(),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red,
              side: BorderSide(color: Colors.red.withOpacity(0.5)),
              padding: EdgeInsets.symmetric(vertical: 14),
            ),
            child: Text('退出登录'),
          ),
        ),

        SizedBox(height: 32),

        // 版本信息
        Center(
          child: Text(
            'LinkingChat v1.0.0',
            style: TextStyle(color: Colors.grey, fontSize: 12),
          ),
        ),
      ],
    );
  }

  Widget _buildSectionCard(List<Widget> children) {
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12), // Telegram 圆角
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(children: children),
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'ONLINE':
        return Colors.green;
      case 'IDLE':
        return Colors.orange;
      case 'DND':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  void _showEditNameDialog(String currentName) {
    final controller = TextEditingController(text: currentName);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 拖动指示器
            Container(
              margin: EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '编辑昵称',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 16),
                  TextField(
                    controller: controller,
                    decoration: InputDecoration(
                      hintText: '请输入昵称',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    autofocus: true,
                  ),
                  SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: Text('取消'),
                      ),
                      SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: () {
                          ref
                              .read(profileProvider.notifier)
                              .updateDisplayName(controller.text);
                          Navigator.pop(context);
                        },
                        child: Text('保存'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showStatusSelector(String currentStatus) {
    final statuses = [
      {'value': 'ONLINE', 'label': '在线', 'icon': Icons.circle, 'color': Colors.green},
      {'value': 'IDLE', 'label': '离开', 'icon': Icons.trip_origin, 'color': Colors.orange},
      {'value': 'DND', 'label': '请勿打扰', 'icon': Icons.do_not_disturb_on, 'color': Colors.red},
      {'value': 'OFFLINE', 'label': '离线', 'icon': Icons.circle_outlined, 'color': Colors.grey},
    ];

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                '选择状态',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ),
            ...statuses.map((status) => ListTile(
                  leading: Icon(
                    status['icon'] as IconData,
                    color: status['color'] as Color,
                  ),
                  title: Text(status['label'] as String),
                  trailing: currentStatus == status['value']
                      ? Icon(Icons.check, color: Theme.of(context).primaryColor)
                      : null,
                  onTap: () {
                    ref
                        .read(profileProvider.notifier)
                        .updateStatus(status['value'] as String);
                    Navigator.pop(context);
                  },
                )),
            SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  void _showAvatarOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                '更换头像',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ),
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
            SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  void _showLogoutConfirmation() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
            child: Text('确定', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }
}
