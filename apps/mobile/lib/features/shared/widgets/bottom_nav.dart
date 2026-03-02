import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../chat/providers/chat_provider.dart';

class BottomNavScaffold extends ConsumerStatefulWidget {
  final Widget child;

  const BottomNavScaffold({super.key, required this.child});

  @override
  ConsumerState<BottomNavScaffold> createState() => _BottomNavScaffoldState();
}

class _BottomNavScaffoldState extends ConsumerState<BottomNavScaffold> {
  @override
  Widget build(BuildContext context) {
    final conversesState = ref.watch(conversesProvider);
    final totalUnread = conversesState.converses
        .fold<int>(0, (sum, c) => sum + c.unreadCount);

    final location = GoRouterState.of(context).matchedLocation;

    return Column(
      children: [
        Expanded(child: widget.child),
        NavigationBar(
          selectedIndex: _getSelectedIndex(location),
          onDestinationSelected: (index) => _onTabSelected(context, index),
          destinations: [
            NavigationDestination(
              icon: Badge(
                isLabelVisible: totalUnread > 0,
                label: Text(totalUnread > 99 ? '99+' : '$totalUnread'),
                child: const Icon(Icons.chat_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: totalUnread > 0,
                label: Text(totalUnread > 99 ? '99+' : '$totalUnread'),
                child: const Icon(Icons.chat),
              ),
              label: 'Chat',
            ),
            const NavigationDestination(
              icon: Icon(Icons.people_outline),
              selectedIcon: Icon(Icons.people),
              label: 'Contacts',
            ),
            const NavigationDestination(
              icon: Icon(Icons.devices_outlined),
              selectedIcon: Icon(Icons.devices),
              label: 'Devices',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Profile',
            ),
          ],
        ),
      ],
    );
  }

  int _getSelectedIndex(String location) {
    if (location.startsWith('/contacts')) return 1;
    if (location.startsWith('/devices')) return 2;
    if (location.startsWith('/profile')) return 3;
    return 0;
  }

  void _onTabSelected(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/chat');
      case 1:
        context.go('/contacts');
      case 2:
        context.go('/devices');
      case 3:
        context.go('/profile');
    }
  }
}
