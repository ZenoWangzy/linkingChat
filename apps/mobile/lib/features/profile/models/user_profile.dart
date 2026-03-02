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

  // Telegram 风格的状态显示
  String get statusText {
    switch (status) {
      case 'ONLINE':
        return '在线';
      case 'IDLE':
        return '离开';
      case 'DND':
        return '请勿打扰';
      case 'OFFLINE':
        return '离线';
      default:
        return '离线';
    }
  }

  bool get isOnline => status == 'ONLINE';
}
