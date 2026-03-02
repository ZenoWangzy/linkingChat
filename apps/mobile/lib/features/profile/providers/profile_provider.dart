// apps/mobile/lib/features/profile/providers/profile_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../models/user_profile.dart';

enum ProfileStatus { initial, loading, success, error }

class ProfileState {
  final UserProfile? profile;
  final ProfileStatus status;
  final String? error;

  const ProfileState({
    this.profile,
    this.status = ProfileStatus.initial,
    this.error,
  });

  ProfileState copyWith({
    UserProfile? profile,
    ProfileStatus? status,
    String? error,
  }) {
    return ProfileState(
      profile: profile ?? this.profile,
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
      final response = await dio.get('/api/v1/profile/me');
      final profile = UserProfile.fromJson(response.data);

      state = ProfileState(
        profile: profile,
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
    final oldProfile = state.profile;
    if (oldProfile == null) return;

    // Optimistic update (Telegram 风格：立即更新 UI)
    state = state.copyWith(
      profile: oldProfile.copyWith(displayName: newName),
    );

    try {
      final dio = _ref.read(dioProvider);
      await dio.patch('/api/v1/profile/me', {
        'displayName': newName,
      });
    } catch (e) {
      // Revert on error
      state = state.copyWith(profile: oldProfile);
      rethrow;
    }
  }

  Future<void> updateStatus(String newStatus) async {
    final oldProfile = state.profile;
    if (oldProfile == null) return;

    // Optimistic update
    state = state.copyWith(
      profile: oldProfile.copyWith(status: newStatus),
    );

    try {
      final dio = _ref.read(dioProvider);
      await dio.patch('/api/v1/profile/me', {
        'status': newStatus,
      });
    } catch (e) {
      // Revert on error
      state = state.copyWith(profile: oldProfile);
      rethrow;
    }
  }

  Future<void> updateAvatar(String avatarUrl) async {
    final oldProfile = state.profile;
    if (oldProfile == null) return;

    state = state.copyWith(
      profile: oldProfile.copyWith(avatarUrl: avatarUrl),
    );
  }
}

final profileProvider =
    StateNotifierProvider<ProfileNotifier, ProfileState>((ref) {
  return ProfileNotifier(ref);
});
