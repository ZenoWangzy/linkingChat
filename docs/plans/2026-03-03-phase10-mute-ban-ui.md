# Phase 10 实施计划：禁言封禁 UI (Telegram 风格)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Flutter Mobile 和 Electron Desktop 添加 Telegram 风格的禁言/封禁管理界面

**Architecture:** 在现有 `GroupDetailPage` 的成员菜单中添加禁言/封禁选项，使用 Modal Bottom Sheet (Flutter) 和 Dialog (Desktop) 实现时长选择器

**Tech Stack:** Flutter 3.x + Riverpod, React 19 + TypeScript, @linkingchat/ws-protocol

**Design Reference:**
- Telegram: 长按成员 → 底部菜单 → Restrict/Ban → 时长网格选择
- WhatsApp: 成员详情 → 底部操作栏 → Restrict → 时长选择器

---

## UI Design Specification

### Mute Dialog (Telegram Style)
```
┌─────────────────────────────────────┐
│  🔇 Mute Member                      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐           │
│  │ 1m  │ │ 10m │ │  1h │           │
│  └─────┘ └─────┘ └─────┘           │
│  ┌─────┐ ┌─────┐ ┌─────┐           │
│  │  1d │ │  1w │ │ 30d │           │
│  └─────┘ └─────┘ └─────┘           │
│                                     │
│  Custom: [____] minutes            │
│                                     │
│  ┌─────────────────────────────┐   │
│  │        Cancel    │   Mute   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Ban Dialog (Telegram Style)
```
┌─────────────────────────────────────┐
│  🚫 Ban & Remove Member              │
├─────────────────────────────────────┤
│                                     │
│  This will remove the member from   │
│  the group and prevent them from    │
│  rejoining.                          │
│                                     │
│  Reason (optional):                 │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │      Cancel    │   Ban      │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Member Tile Muted State
```
┌─────────────────────────────────────┐
│  [Avatar]  Username  [ADMIN]  🔇    │
│            @handle                   │
│            Muted until 14:30        │
└─────────────────────────────────────┘
```

---

## Task 1: Flutter - API Client 方法

**Files:**
- Modify: `apps/mobile/lib/core/network/api_client.dart`
- Create: `apps/mobile/lib/core/services/group_moderation_service.dart`

**Step 1: Create GroupModerationService**

```dart
// apps/mobile/lib/core/services/group_moderation_service.dart
import 'package:dio/dio.dart';
import '../network/api_client.dart';

class GroupModerationService {
  final Dio _dio;

  GroupModerationService(this._dio);

  /// Mute a group member
  Future<MuteResult> muteMember({
    required String converseId,
    required String memberId,
    required int durationMinutes,
  }) async {
    final response = await _dio.patch(
      '/api/v1/converses/groups/$converseId/members/$memberId/mute',
      data: {'durationMinutes': durationMinutes},
    );
    return MuteResult.fromJson(response.data);
  }

  /// Unmute a group member
  Future<void> unmuteMember({
    required String converseId,
    required String memberId,
  }) async {
    await _dio.delete(
      '/api/v1/converses/groups/$converseId/members/$memberId/mute',
    );
  }

  /// Ban a group member
  Future<BanResult> banMember({
    required String converseId,
    required String userId,
    String? reason,
  }) async {
    final response = await _dio.post(
      '/api/v1/converses/groups/$converseId/bans/$userId',
      data: {'reason': reason},
    );
    return BanResult.fromJson(response.data);
  }

  /// Unban a user
  Future<void> unbanMember({
    required String converseId,
    required String userId,
  }) async {
    await _dio.delete(
      '/api/v1/converses/groups/$converseId/bans/$userId',
    );
  }

  /// Get group ban list
  Future<List<GroupBan>> getGroupBans({
    required String converseId,
  }) async {
    final response = await _dio.get(
      '/api/v1/converses/groups/$converseId/bans',
    );
    return (response.data['bans'] as List)
        .map((b) => GroupBan.fromJson(b))
        .toList();
  }
}

class MuteResult {
  final DateTime mutedUntil;

  MuteResult({required this.mutedUntil});

  factory MuteResult.fromJson(Map<String, dynamic> json) {
    return MuteResult(
      mutedUntil: DateTime.parse(json['mutedUntil']),
    );
  }
}

class BanResult {
  final bool banned;
  final bool removedFromGroup;

  BanResult({required this.banned, required this.removedFromGroup});

  factory BanResult.fromJson(Map<String, dynamic> json) {
    return BanResult(
      banned: json['banned'],
      removedFromGroup: json['removedFromGroup'],
    );
  }
}

class GroupBan {
  final String userId;
  final String bannedBy;
  final String? reason;
  final DateTime createdAt;

  GroupBan({
    required this.userId,
    required this.bannedBy,
    this.reason,
    required this.createdAt,
  });

  factory GroupBan.fromJson(Map<String, dynamic> json) {
    return GroupBan(
      userId: json['userId'],
      bannedBy: json['bannedBy'],
      reason: json['reason'],
      createdAt: DateTime.parse(json['createdAt']),
    );
  }
}
```

**Step 2: Register service in provider**

Add to `apps/mobile/lib/core/network/api_client.dart`:
```dart
// Add to ApiClient class
late final GroupModerationService groupModeration;

// In constructor:
groupModeration = GroupModerationService(_dio);
```

**Step 3: Verify file compiles**

Run: `cd apps/mobile && flutter analyze lib/core/services/group_moderation_service.dart`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/mobile/lib/core/services/group_moderation_service.dart
git commit -m "feat(mobile): add GroupModerationService for mute/ban API"
```

---

## Task 2: Flutter - Mute Duration Picker Widget

**Files:**
- Create: `apps/mobile/lib/features/chat/widgets/mute_duration_picker.dart`

**Step 1: Create MuteDurationPicker widget**

```dart
// apps/mobile/lib/features/chat/widgets/mute_duration_picker.dart
import 'package:flutter/material.dart';

/// Telegram-style mute duration presets
const kMutePresets = [
  _Preset(label: '1 min', minutes: 1),
  _Preset(label: '10 min', minutes: 10),
  _Preset(label: '1 hour', minutes: 60),
  _Preset(label: '1 day', minutes: 1440),
  _Preset(label: '1 week', minutes: 10080),
  _Preset(label: '1 month', minutes: 43200),
];

class _Preset {
  final String label;
  final int minutes;

  const _Preset({required this.label, required this.minutes});
}

class MuteDurationPicker extends StatefulWidget {
  final int? initialMinutes;
  final void Function(int durationMinutes) onConfirm;
  final VoidCallback onCancel;

  const MuteDurationPicker({
    super.key,
    this.initialMinutes,
    required this.onConfirm,
    required this.onCancel,
  });

  @override
  State<MuteDurationPicker> createState() => _MuteDurationPickerState();
}

class _MuteDurationPickerState extends State<MuteDurationPicker> {
  int? _selectedPreset;
  TextEditingController? _customController;
  bool _useCustom = false;

  @override
  void initState() {
    super.initState();
    _customController = TextEditingController();
    if (widget.initialMinutes != null) {
      final presetIndex = kMutePresets.indexWhere(
        (p) => p.minutes == widget.initialMinutes,
      );
      if (presetIndex >= 0) {
        _selectedPreset = presetIndex;
      } else {
        _useCustom = true;
        _customController!.text = widget.initialMinutes.toString();
      }
    }
  }

  @override
  void dispose() {
    _customController?.dispose();
    super.dispose();
  }

  int get _selectedMinutes {
    if (_useCustom) {
      return int.tryParse(_customController?.text ?? '') ?? 0;
    }
    if (_selectedPreset != null) {
      return kMutePresets[_selectedPreset!].minutes;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              const Icon(Icons.volume_off, size: 24),
              const SizedBox(width: 12),
              Text(
                'Mute Member',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Preset grid
          GridView.count(
            shrinkWrap: true,
            crossAxisCount: 3,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 2.2,
            children: List.generate(kMutePresets.length, (index) {
              final preset = kMutePresets[index];
              final isSelected = !_useCustom && _selectedPreset == index;
              return _PresetButton(
                label: preset.label,
                isSelected: isSelected,
                onTap: () => setState(() {
                  _selectedPreset = index;
                  _useCustom = false;
                }),
              );
            }),
          ),

          const SizedBox(height: 16),

          // Custom input
          TextField(
            controller: _customController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: 'Custom (minutes)',
              border: const OutlineInputBorder(),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 12,
              ),
              suffixText: 'min',
            ),
            onChanged: (value) {
              if (value.isNotEmpty) {
                setState(() {
                  _useCustom = true;
                  _selectedPreset = null;
                });
              }
            },
          ),

          const SizedBox(height: 24),

          // Actions
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: widget.onCancel,
                child: const Text('Cancel'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _selectedMinutes > 0
                    ? () => widget.onConfirm(_selectedMinutes)
                    : null,
                child: const Text('Mute'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PresetButton extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _PresetButton({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isSelected
          ? Theme.of(context).colorScheme.primaryContainer
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              color: isSelected
                  ? Theme.of(context).colorScheme.onPrimaryContainer
                  : null,
            ),
          ),
        ),
      ),
    );
  }
}

/// Helper function to show mute picker as bottom sheet
Future<void> showMuteDurationPicker({
  required BuildContext context,
  int? initialMinutes,
  required void Function(int durationMinutes) onConfirm,
}) async {
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => MuteDurationPicker(
      initialMinutes: initialMinutes,
      onConfirm: (minutes) {
        Navigator.pop(ctx);
        onConfirm(minutes);
      },
      onCancel: () => Navigator.pop(ctx),
    ),
  );
}
```

**Step 2: Verify file compiles**

Run: `cd apps/mobile && flutter analyze lib/features/chat/widgets/mute_duration_picker.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/mobile/lib/features/chat/widgets/mute_duration_picker.dart
git commit -m "feat(mobile): add Telegram-style MuteDurationPicker widget"
```

---

## Task 3: Flutter - Ban Dialog Widget

**Files:**
- Create: `apps/mobile/lib/features/chat/widgets/ban_member_dialog.dart`

**Step 1: Create BanMemberDialog widget**

```dart
// apps/mobile/lib/features/chat/widgets/ban_member_dialog.dart
import 'package:flutter/material.dart';

class BanMemberDialog extends StatefulWidget {
  final String memberName;
  final void Function(String? reason) onConfirm;
  final VoidCallback onCancel;

  const BanMemberDialog({
    super.key,
    required this.memberName,
    required this.onConfirm,
    required this.onCancel,
  });

  @override
  State<BanMemberDialog> createState() => _BanMemberDialogState();
}

class _BanMemberDialogState extends State<BanMemberDialog> {
  final _reasonController = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.block, color: Colors.red, size: 32),
      title: const Text('Ban & Remove Member'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This will remove ${widget.memberName} from the group and prevent them from rejoining.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _reasonController,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Reason (optional)',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _isLoading ? null : widget.onCancel,
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Colors.red,
          ),
          onPressed: _isLoading
              ? null
              : () {
                  setState(() => _isLoading = true);
                  widget.onConfirm(
                    _reasonController.text.trim().isEmpty
                        ? null
                        : _reasonController.text.trim(),
                  );
                },
          child: _isLoading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Ban'),
        ),
      ],
    );
  }
}

/// Helper function to show ban dialog
Future<void> showBanMemberDialog({
  required BuildContext context,
  required String memberName,
  required void Function(String? reason) onConfirm,
}) async {
  await showDialog(
    context: context,
    builder: (ctx) => BanMemberDialog(
      memberName: memberName,
      onConfirm: (reason) {
        Navigator.pop(ctx);
        onConfirm(reason);
      },
      onCancel: () => Navigator.pop(ctx),
    ),
  );
}
```

**Step 2: Verify file compiles**

Run: `cd apps/mobile && flutter analyze lib/features/chat/widgets/ban_member_dialog.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/mobile/lib/features/chat/widgets/ban_member_dialog.dart
git commit -m "feat(mobile): add BanMemberDialog widget"
```

---

## Task 4: Flutter - Update GroupDetailPage Member Menu

**Files:**
- Modify: `apps/mobile/lib/features/chat/pages/group_detail_page.dart`

**Step 1: Add imports**

Add at top of file:
```dart
import '../widgets/mute_duration_picker.dart';
import '../widgets/ban_member_dialog.dart';
import '../../../core/services/group_moderation_service.dart';
```

**Step 2: Add mutedUntil to ConverseMemberModel check**

In `_buildMemberTile`, add muted indicator after role badge:
```dart
// Add after role badge (around line 165)
if (member.mutedUntil != null && member.mutedUntil!.isAfter(DateTime.now()))
  ...[
    const SizedBox(width: 4),
    Icon(Icons.volume_off, size: 14, color: Colors.orange.shade700),
  ],
```

**Step 3: Update PopupMenuButton items**

Replace the `itemBuilder` in `_buildMemberTile` (around line 173):
```dart
itemBuilder: (context) => [
  // Promote/Demote (existing)
  if (_isOwner && member.role != 'ADMIN')
    const PopupMenuItem(value: 'promote', child: Text('Make Admin')),
  if (_isOwner && member.role == 'ADMIN')
    const PopupMenuItem(value: 'demote', child: Text('Remove Admin')),

  // Mute/Unmute (new)
  if (_canManage && member.mutedUntil == null)
    const PopupMenuItem(
      value: 'mute',
      child: Row(
        children: [
          Icon(Icons.volume_off, size: 20),
          SizedBox(width: 12),
          Text('Mute'),
        ],
      ),
    ),
  if (_canManage && member.mutedUntil != null)
    const PopupMenuItem(
      value: 'unmute',
      child: Row(
        children: [
          Icon(Icons.volume_up, size: 20),
          SizedBox(width: 12),
          Text('Unmute'),
        ],
      ),
    ),

  // Ban (new)
  if (_canManage)
    const PopupMenuItem(
      value: 'ban',
      child: Row(
        children: [
          Icon(Icons.block, size: 20, color: Colors.red),
          SizedBox(width: 12),
          Text('Ban', style: TextStyle(color: Colors.red)),
        ],
      ),
    ),

  // Remove (existing)
  const PopupMenuItem(
    value: 'remove',
    child: Text('Remove', style: TextStyle(color: Colors.red)),
  ),
],
```

**Step 4: Add mute/unmute/ban handlers**

Add to `_handleMemberAction` switch:
```dart
case 'mute':
  await showMuteDurationPicker(
    context: context,
    onConfirm: (minutes) async {
      final dio = ref.read(dioProvider);
      await dio.patch(
        '/api/v1/converses/groups/${widget.converseId}/members/${member.userId}/mute',
        data: {'durationMinutes': minutes},
      );
      await ref.read(conversesProvider.notifier).fetchConverses();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Muted ${member.displayName} for $minutes minutes')),
        );
      }
    },
  );
  return; // Don't set isLoading false yet, showMuteDurationPicker handles it

case 'unmute':
  final dio = ref.read(dioProvider);
  await dio.delete(
    '/api/v1/converses/groups/${widget.converseId}/members/${member.userId}/mute',
  );
  await ref.read(conversesProvider.notifier).fetchConverses();
  if (mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Unmuted ${member.displayName}')),
    );
  }

case 'ban':
  await showBanMemberDialog(
    context: context,
    memberName: member.displayName,
    onConfirm: (reason) async {
      final dio = ref.read(dioProvider);
      await dio.post(
        '/api/v1/converses/groups/${widget.converseId}/bans/${member.userId}',
        data: {'reason': reason},
      );
      await ref.read(conversesProvider.notifier).fetchConverses();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Banned ${member.displayName}')),
        );
      }
    },
  );
  return;
```

**Step 5: Verify file compiles**

Run: `cd apps/mobile && flutter analyze lib/features/chat/pages/group_detail_page.dart`
Expected: No errors

**Step 6: Commit**

```bash
git add apps/mobile/lib/features/chat/pages/group_detail_page.dart
git commit -m "feat(mobile): add mute/ban options to group member menu"
```

---

## Task 5: Flutter - ConverseMemberModel mutedUntil Field

**Files:**
- Modify: `apps/mobile/lib/core/models/converse_member.dart`

**Step 1: Add mutedUntil field**

```dart
// apps/mobile/lib/core/models/converse_member.dart
class ConverseMemberModel {
  final String userId;
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String? role;
  final bool isOpen;
  final DateTime? mutedUntil;  // Add this field

  ConverseMemberModel({
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatarUrl,
    this.role,
    this.isOpen = true,
    this.mutedUntil,  // Add this
  });

  factory ConverseMemberModel.fromJson(Map<String, dynamic> json) {
    return ConverseMemberModel(
      userId: json['userId'] ?? json['user']['id'],
      username: json['username'] ?? json['user']['username'],
      displayName: json['displayName'] ?? json['user']['displayName'] ?? json['username'] ?? 'Unknown',
      avatarUrl: json['avatarUrl'] ?? json['user']['avatarUrl'],
      role: json['role'],
      isOpen: json['isOpen'] ?? true,
      mutedUntil: json['mutedUntil'] != null
          ? DateTime.parse(json['mutedUntil'])
          : null,
    );
  }
}
```

**Step 2: Verify file compiles**

Run: `cd apps/mobile && flutter analyze lib/core/models/converse_member.dart`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/mobile/lib/core/models/converse_member.dart
git commit -m "feat(mobile): add mutedUntil field to ConverseMemberModel"
```

---

## Task 6: Desktop - API Client Methods

**Files:**
- Create: `apps/desktop/src/renderer/services/group-moderation.ts`

**Step 1: Create group-moderation service**

```typescript
// apps/desktop/src/renderer/services/group-moderation.ts
import { apiClient } from './api-client';

export interface MuteResult {
  mutedUntil: string;
}

export interface BanResult {
  banned: boolean;
  removedFromGroup: boolean;
}

export interface GroupBan {
  userId: string;
  bannedBy: string;
  reason?: string;
  createdAt: string;
}

export const groupModerationService = {
  async muteMember(
    converseId: string,
    memberId: string,
    durationMinutes: number,
  ): Promise<MuteResult> {
    const { data } = await apiClient.patch<MuteResult>(
      `/api/v1/converses/groups/${converseId}/members/${memberId}/mute`,
      { durationMinutes },
    );
    return data;
  },

  async unmuteMember(
    converseId: string,
    memberId: string,
  ): Promise<void> {
    await apiClient.delete(
      `/api/v1/converses/groups/${converseId}/members/${memberId}/mute`,
    );
  },

  async banMember(
    converseId: string,
    userId: string,
    reason?: string,
  ): Promise<BanResult> {
    const { data } = await apiClient.post<BanResult>(
      `/api/v1/converses/groups/${converseId}/bans/${userId}`,
      { reason },
    );
    return data;
  },

  async unbanMember(
    converseId: string,
    userId: string,
  ): Promise<void> {
    await apiClient.delete(
      `/api/v1/converses/groups/${converseId}/bans/${userId}`,
    );
  },

  async getGroupBans(converseId: string): Promise<GroupBan[]> {
    const { data } = await apiClient.get<{ bans: GroupBan[] }>(
      `/api/v1/converses/groups/${converseId}/bans`,
    );
    return data.bans;
  },
};
```

**Step 2: Verify file compiles**

Run: `pnpm --filter "@linkingchat/desktop" type-check`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/services/group-moderation.ts
git commit -m "feat(desktop): add groupModerationService"
```

---

## Task 7: Desktop - Mute Duration Picker Component

**Files:**
- Create: `apps/desktop/src/renderer/components/MuteDurationPicker.tsx`

**Step 1: Create MuteDurationPicker component**

```tsx
// apps/desktop/src/renderer/components/MuteDurationPicker.tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VolumeX } from 'lucide-react';

// Telegram-style presets
const MUTE_PRESETS = [
  { label: '1 min', minutes: 1 },
  { label: '10 min', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
  { label: '1 month', minutes: 43200 },
] as const;

interface MuteDurationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (durationMinutes: number) => void;
  initialMinutes?: number;
}

export function MuteDurationPicker({
  open,
  onOpenChange,
  onConfirm,
  initialMinutes,
}: MuteDurationPickerProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(() => {
    if (initialMinutes) {
      const idx = MUTE_PRESETS.findIndex((p) => p.minutes === initialMinutes);
      return idx >= 0 ? idx : null;
    }
    return null;
  });
  const [customMinutes, setCustomMinutes] = useState<string>(() => {
    if (initialMinutes && !MUTE_PRESETS.some((p) => p.minutes === initialMinutes)) {
      return String(initialMinutes);
    }
    return '';
  });

  const selectedMinutes = customMinutes
    ? parseInt(customMinutes, 10) || 0
    : selectedPreset !== null
      ? MUTE_PRESETS[selectedPreset].minutes
      : 0;

  const handlePresetClick = (index: number) => {
    setSelectedPreset(index);
    setCustomMinutes('');
  };

  const handleCustomChange = (value: string) => {
    setCustomMinutes(value);
    setSelectedPreset(null);
  };

  const handleConfirm = () => {
    if (selectedMinutes > 0) {
      onConfirm(selectedMinutes);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <VolumeX className="h-5 w-5" />
            Mute Member
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {/* Preset grid */}
          <div className="grid grid-cols-3 gap-2">
            {MUTE_PRESETS.map((preset, index) => (
              <button
                key={preset.minutes}
                onClick={() => handlePresetClick(index)}
                className={`
                  rounded-lg px-3 py-2 text-sm font-medium transition-colors
                  ${selectedPreset === index
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                  }
                `}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="mt-4">
            <Label htmlFor="custom-minutes">Custom (minutes)</Label>
            <Input
              id="custom-minutes"
              type="number"
              min={1}
              max={43200}
              value={customMinutes}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder="Enter minutes..."
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedMinutes <= 0}
          >
            Mute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify file compiles**

Run: `pnpm --filter "@linkingchat/desktop" type-check`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/MuteDurationPicker.tsx
git commit -m "feat(desktop): add MuteDurationPicker component"
```

---

## Task 8: Desktop - Ban Member Dialog Component

**Files:**
- Create: `apps/desktop/src/renderer/components/BanMemberDialog.tsx`

**Step 1: Create BanMemberDialog component**

```tsx
// apps/desktop/src/renderer/components/BanMemberDialog.tsx
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Ban } from 'lucide-react';

interface BanMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  onConfirm: (reason?: string) => void;
}

export function BanMemberDialog({
  open,
  onOpenChange,
  memberName,
  onConfirm,
}: BanMemberDialogProps) {
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      onConfirm(reason.trim() || undefined);
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-5 w-5" />
            Ban & Remove Member
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will remove <strong>{memberName}</strong> from the group and
            prevent them from rejoining.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <Label htmlFor="ban-reason">Reason (optional)</Label>
          <Textarea
            id="ban-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for banning..."
            maxLength={500}
            rows={3}
            className="mt-1"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Banning...' : 'Ban'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Step 2: Verify file compiles**

Run: `pnpm --filter "@linkingchat/desktop" type-check`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/BanMemberDialog.tsx
git commit -m "feat(desktop): add BanMemberDialog component"
```

---

## Task 9: Desktop - Update ChatPage with Member Actions

**Files:**
- Modify: `apps/desktop/src/renderer/pages/ChatPage.tsx` (or the group info panel component)

**Step 1: Add imports and state**

```tsx
// Add imports
import { MuteDurationPicker } from '@/components/MuteDurationPicker';
import { BanMemberDialog } from '@/components/BanMemberDialog';
import { groupModerationService } from '@/services/group-moderation';
import { VolumeOff, Ban, VolumeUp } from 'lucide-react';

// Add state in component
const [mutePickerOpen, setMutePickerOpen] = useState(false);
const [banDialogOpen, setBanDialogOpen] = useState(false);
const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
const [selectedMemberName, setSelectedMemberName] = useState<string>('');
```

**Step 2: Add mute/ban menu items to member dropdown**

In the member list/context menu (find the existing menu):
```tsx
{/* Mute/Unmute */}
{canManage && member.mutedUntil === null && (
  <DropdownMenuItem
    onClick={() => {
      setSelectedMemberId(member.userId);
      setSelectedMemberName(member.displayName);
      setMutePickerOpen(true);
    }}
  >
    <VolumeOff className="mr-2 h-4 w-4" />
    Mute
  </DropdownMenuItem>
)}
{canManage && member.mutedUntil !== null && (
  <DropdownMenuItem
    onClick={() => handleUnmute(member.userId)}
  >
    <VolumeUp className="mr-2 h-4 w-4" />
    Unmute
  </DropdownMenuItem>
)}

{/* Ban */}
{canManage && (
  <DropdownMenuItem
    className="text-destructive"
    onClick={() => {
      setSelectedMemberId(member.userId);
      setSelectedMemberName(member.displayName);
      setBanDialogOpen(true);
    }}
  >
    <Ban className="mr-2 h-4 w-4" />
    Ban
  </DropdownMenuItem>
)}
```

**Step 3: Add handler functions**

```tsx
const handleMute = async (durationMinutes: number) => {
  if (!converseId || !selectedMemberId) return;
  try {
    await groupModerationService.muteMember(
      converseId,
      selectedMemberId,
      durationMinutes,
    );
    toast.success(`Muted for ${durationMinutes} minutes`);
    refetchConverses();
  } catch (error) {
    toast.error('Failed to mute member');
  }
};

const handleUnmute = async (memberId: string) => {
  if (!converseId) return;
  try {
    await groupModerationService.unmuteMember(converseId, memberId);
    toast.success('Member unmuted');
    refetchConverses();
  } catch (error) {
    toast.error('Failed to unmute member');
  }
};

const handleBan = async (reason?: string) => {
  if (!converseId || !selectedMemberId) return;
  try {
    await groupModerationService.banMember(
      converseId,
      selectedMemberId,
      reason,
    );
    toast.success('Member banned');
    refetchConverses();
  } catch (error) {
    toast.error('Failed to ban member');
  }
};
```

**Step 4: Add dialog components at end of JSX**

```tsx
{/* Mute Duration Picker */}
<MuteDurationPicker
  open={mutePickerOpen}
  onOpenChange={setMutePickerOpen}
  onConfirm={handleMute}
/>

{/* Ban Dialog */}
<BanMemberDialog
  open={banDialogOpen}
  onOpenChange={setBanDialogOpen}
  memberName={selectedMemberName}
  onConfirm={handleBan}
/>
```

**Step 5: Verify file compiles**

Run: `pnpm --filter "@linkingchat/desktop" type-check`
Expected: No errors

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/pages/ChatPage.tsx
git commit -m "feat(desktop): add mute/ban actions to group member menu"
```

---

## Task 10: Final Integration & Testing

**Step 1: Run all tests**

```bash
pnpm test
```
Expected: All 287 tests pass

**Step 2: Build all packages**

```bash
pnpm build
```
Expected: All 4 packages build successfully

**Step 3: Manual testing checklist**

- [ ] Flutter: Open group → Long press member → Mute → Select duration → Confirm
- [ ] Flutter: Verify muted member shows 🔇 icon
- [ ] Flutter: Muted member cannot send messages (403 error)
- [ ] Flutter: Unmute member → Verify icon removed
- [ ] Flutter: Ban member with reason → Verify member removed
- [ ] Flutter: Banned member cannot rejoin
- [ ] Desktop: Same flow verification

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 10 complete - mute/ban UI for Flutter and Desktop"
```

---

## Files Changed Summary

| Platform | File | Action |
|----------|------|--------|
| Flutter | `lib/core/services/group_moderation_service.dart` | Create |
| Flutter | `lib/core/models/converse_member.dart` | Modify |
| Flutter | `lib/features/chat/widgets/mute_duration_picker.dart` | Create |
| Flutter | `lib/features/chat/widgets/ban_member_dialog.dart` | Create |
| Flutter | `lib/features/chat/pages/group_detail_page.dart` | Modify |
| Desktop | `src/renderer/services/group-moderation.ts` | Create |
| Desktop | `src/renderer/components/MuteDurationPicker.tsx` | Create |
| Desktop | `src/renderer/components/BanMemberDialog.tsx` | Create |
| Desktop | `src/renderer/pages/ChatPage.tsx` | Modify |

---

## Acceptance Criteria

- [ ] OWNER/ADMIN can mute member via Telegram-style duration picker
- [ ] Muted member shows 🔇 icon in member list
- [ ] Muted member receives 403 error when sending message
- [ ] OWNER/ADMIN can unmute member
- [ ] OWNER/ADMIN can ban member with optional reason
- [ ] Banned member is removed from group immediately
- [ ] Banned member cannot rejoin group
- [ ] All tests pass
- [ ] Build succeeds
