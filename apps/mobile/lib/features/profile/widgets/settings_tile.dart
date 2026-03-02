// apps/mobile/lib/features/profile/widgets/settings_tile.dart
import 'package:flutter/material.dart';

class SettingsTile extends StatelessWidget {
  final IconData icon;
  final Color? iconColor;
  final String title;
  final String subtitle;
  final bool enabled;
  final VoidCallback? onTap;

  const SettingsTile({
    required this.icon,
    this.iconColor,
    required this.title,
    required this.subtitle,
    this.enabled = true,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: (iconColor ?? theme.primaryColor).withOpacity(0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(
          icon,
          color: iconColor ?? theme.primaryColor,
          size: 22,
        ),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w500,
          color: enabled ? null : Colors.grey,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(
          fontSize: 14,
          color: Colors.grey[600],
        ),
      ),
      trailing: enabled && onTap != null
          ? Icon(Icons.chevron_right, color: Colors.grey[400])
          : null,
      onTap: enabled ? onTap : null,
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    );
  }
}
