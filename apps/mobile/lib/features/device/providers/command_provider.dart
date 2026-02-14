import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/ws_service.dart';
import '../../../core/constants/ws_events.dart';
import '../models/command_result.dart';

enum CommandState { idle, sending, waiting, completed, error }

class CommandStatus {
  final CommandState state;
  final CommandResult? result;
  final String? errorMessage;

  const CommandStatus({
    this.state = CommandState.idle,
    this.result,
    this.errorMessage,
  });

  CommandStatus copyWith({
    CommandState? state,
    CommandResult? result,
    String? errorMessage,
  }) {
    return CommandStatus(
      state: state ?? this.state,
      result: result ?? this.result,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class CommandNotifier extends StateNotifier<CommandStatus> {
  final Ref _ref;
  String? _currentCommandId;
  String? _serverCommandId;

  CommandNotifier(this._ref) : super(const CommandStatus()) {
    _listenForResults();
  }

  void _listenForResults() {
    final wsService = _ref.read(wsServiceProvider);

    wsService.on(WsEvents.resultDelivered, (data) {
      final result = CommandResult.fromJson(data as Map<String, dynamic>);

      if (result.commandId == _serverCommandId) {
        state = CommandStatus(
          state: CommandState.completed,
          result: result,
        );
      }
    });

    wsService.on(WsEvents.commandAck, (data) {
      final payload = data as Map<String, dynamic>;
      // Server generates its own commandId (Prisma cuid).
      // Accept ACK and track the server's ID for matching the result.
      if (state.state == CommandState.sending) {
        _serverCommandId = payload['commandId'] as String;
        state = state.copyWith(state: CommandState.waiting);
      }
    });

    wsService.on(WsEvents.commandSendError, (data) {
      // Fired when emitWithAck returns success:false (e.g. COMMAND_DANGEROUS).
      if (state.state == CommandState.sending) {
        final response = data is Map ? data : {};
        final error = response['error'];
        final message = error is Map ? error['message'] as String? : null;
        state = CommandStatus(
          state: CommandState.error,
          errorMessage: message ?? 'Command rejected',
        );
      }
    });
  }

  Future<void> executeCommand({
    required String targetDeviceId,
    required String action,
  }) async {
    _currentCommandId = 'cmd_${DateTime.now().millisecondsSinceEpoch}';

    state = const CommandStatus(state: CommandState.sending);

    final wsService = _ref.read(wsServiceProvider);
    wsService.sendCommand(
      requestId: _currentCommandId!,
      targetDeviceId: targetDeviceId,
      action: action,
    );

    Future.delayed(const Duration(seconds: 30), () {
      if (state.state == CommandState.sending ||
          state.state == CommandState.waiting) {
        state = const CommandStatus(
          state: CommandState.error,
          errorMessage: 'Command timed out (30s)',
        );
      }
    });
  }

  void reset() {
    _currentCommandId = null;
    _serverCommandId = null;
    state = const CommandStatus();
  }

  @override
  void dispose() {
    final wsService = _ref.read(wsServiceProvider);
    wsService.off(WsEvents.resultDelivered);
    wsService.off(WsEvents.commandAck);
    wsService.off(WsEvents.commandSendError);
    super.dispose();
  }
}

final commandProvider =
    StateNotifierProvider<CommandNotifier, CommandStatus>((ref) {
  return CommandNotifier(ref);
});
