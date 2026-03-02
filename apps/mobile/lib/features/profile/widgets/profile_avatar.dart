// apps/mobile/lib/features/profile/widgets/profile_avatar.dart
import 'package:flutter/material.dart';

class ProfileAvatar extends StatelessWidget {
  final String? avatarUrl;
  final String displayName;
  final bool isOnline;
  final String statusText;
  final VoidCallback onAvatarTap;

  const ProfileAvatar({
    required this.avatarUrl,
    required this.displayName,
    required this.isOnline,
    required this.statusText,
    required this.onAvatarTap,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        children: [
          SizedBox(height: 24),
          // Telegram 风格的大头像
          GestureDetector(
            onTap: onAvatarTap,
            child: Stack(
              children: [
                Container(
                  width: 120,
                  height: 120,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.grey[300],
                    image: avatarUrl != null
                        ? DecorationImage(
                            image: NetworkImage(avatarUrl!),
                            fit: BoxFit.cover,
                          )
                        : null,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.1),
                        blurRadius: 20,
                        offset: Offset(0, 10),
                      ),
                    ],
                  ),
                  child: avatarUrl == null
                      ? Icon(Icons.person, size: 60, color: Colors.grey[600])
                      : null,
                ),
                // 在线状态指示器
                Positioned(
                  bottom: 4,
                  right: 4,
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: isOnline ? Colors.green : Colors.grey,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                    ),
                  ),
                ),
                // 编辑图标
                Positioned(
                  bottom: 0,
                  left: 0,
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: Theme.of(context).primaryColor,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: Icon(Icons.edit, size: 18, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 16),
          // 名字
          Text(
            displayName,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(height: 4),
          // 状态文本
          Text(
            statusText,
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[600],
            ),
          ),
        ],
      ),
    );
  }
}
