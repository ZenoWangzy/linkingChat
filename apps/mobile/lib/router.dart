import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/auth/pages/login_page.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/device/pages/device_list_page.dart';
import 'features/device/pages/command_page.dart';
import 'features/chat/pages/converses_list_page.dart';
import 'features/chat/pages/chat_thread_page.dart';
import 'features/chat/pages/group_detail_page.dart';
import 'features/friends/pages/friends_list_page.dart';
import 'features/friends/pages/add_friend_page.dart';
import 'features/profile/pages/profile_page.dart';
import 'features/shared/widgets/bottom_nav.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/chat',
    refreshListenable: _AuthRefreshNotifier(ref),
    redirect: (context, state) {
      final isAuth = authState.status == AuthStatus.authenticated;
      final isLoginRoute = state.matchedLocation == '/login';

      if (!isAuth && !isLoginRoute) return '/login';
      if (isAuth && isLoginRoute) return '/chat';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginPage(),
      ),
      // Tab pages wrapped with bottom navigation
      ShellRoute(
        builder: (context, state, child) => BottomNavScaffold(child: child),
        routes: [
          GoRoute(
            path: '/chat',
            builder: (context, state) => const ConversesListPage(),
          ),
          GoRoute(
            path: '/contacts',
            builder: (context, state) => const FriendsListPage(),
          ),
          GoRoute(
            path: '/devices',
            builder: (context, state) => const DeviceListPage(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfilePage(),
          ),
        ],
      ),
      // Full-screen pages (no bottom nav)
      GoRoute(
        path: '/chat/:converseId',
        builder: (context, state) => ChatThreadPage(
          converseId: state.pathParameters['converseId']!,
        ),
      ),
      GoRoute(
        path: '/chat/:converseId/group',
        builder: (context, state) => GroupDetailPage(
          converseId: state.pathParameters['converseId']!,
        ),
      ),
      GoRoute(
        path: '/contacts/add',
        builder: (context, state) => const AddFriendPage(),
      ),
      GoRoute(
        path: '/command/:deviceId',
        builder: (context, state) => CommandPage(
          deviceId: state.pathParameters['deviceId']!,
        ),
      ),
    ],
  );
});

/// Bridges Riverpod auth state changes to GoRouter's refreshListenable.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(this._ref) {
    _ref.listen<AuthState>(authProvider, (_, __) => notifyListeners());
  }
  final Ref _ref;
}
