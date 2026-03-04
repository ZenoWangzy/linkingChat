import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../constants/api_endpoints.dart';
import '../services/group_moderation_service.dart';
import '../../features/auth/providers/auth_provider.dart';
import 'auth_repository.dart';
import 'auth_interceptor.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository();
});

final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: ApiEndpoints.baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
    headers: {'Content-Type': 'application/json'},
  ));

  final authRepo = ref.read(authRepositoryProvider);
  dio.interceptors.add(AuthInterceptor(
    authRepo: authRepo,
    dio: dio,
    onAuthExpired: () {
      ref.read(authProvider.notifier).logout();
    },
  ));

  return dio;
});

final groupModerationServiceProvider = Provider<GroupModerationService>((ref) {
  final dio = ref.read(dioProvider);
  return GroupModerationService(dio);
});
