// apps/mobile/lib/features/profile/models/user_profile.g.dart
// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'user_profile.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UserProfile _$UserProfileFromJson(Map<String, dynamic> json) => UserProfile(
      id: json['id'] as String,
      email: json['email'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      avatarUrl: json['avatarUrl'] as String?,
      status: json['status'] as String,
      lastSeenAt: json['lastSeenAt'] == null
          ? null
          : DateTime.parse(json['lastSeenAt'] as String),
    );

Map<String, dynamic> _$UserProfileToJson(UserProfile instance) =>
    <String, dynamic>{
      'id': instance.id,
      'email': instance.email,
      'username': instance.username,
      'displayName': instance.displayName,
      'avatarUrl': instance.avatarUrl,
      'status': instance.status,
      'lastSeenAt': instance.lastSeenAt?.toIso8601String(),
    };
