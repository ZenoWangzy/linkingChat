import 'package:flutter/foundation.dart' show debugPrint, kIsWeb;
import 'package:socket_io_client/socket_io_client.dart' as sio;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../constants/api_endpoints.dart';
import '../constants/ws_events.dart';
import 'auth_repository.dart';
import 'api_client.dart';

enum WsConnectionState { disconnected, connecting, connected, error }

class WsService {
  sio.Socket? _socket;
  final AuthRepository _authRepo;

  WsConnectionState _state = WsConnectionState.disconnected;
  WsConnectionState get state => _state;

  final Map<String, List<Function(dynamic)>> _listeners = {};

  WsService({required AuthRepository authRepo}) : _authRepo = authRepo;

  Future<void> connect() async {
    if (_state == WsConnectionState.connected ||
        _state == WsConnectionState.connecting) {
      return;
    }
    _state = WsConnectionState.connecting;

    final token = await _authRepo.accessToken;
    if (token == null) {
      _state = WsConnectionState.error;
      debugPrint('[WS] No token, cannot connect');
      return;
    }

    final builder = sio.OptionBuilder()
        .setAuth({'token': token, 'deviceType': 'mobile'})
        .enableReconnection()
        .setReconnectionDelay(1000)
        .setReconnectionDelayMax(30000);

    if (!kIsWeb) {
      builder.setTransports(['websocket']);
    }

    _socket = sio.io(
      '${ApiEndpoints.baseUrl}/device',
      builder.build(),
    );

    _socket!.onConnect((_) {
      _state = WsConnectionState.connected;
      debugPrint('[WS] Connected! socket.id=${_socket?.id}');
      _notifyListeners('connection', {'state': 'connected'});
    });

    _socket!.onDisconnect((_) {
      _state = WsConnectionState.disconnected;
      debugPrint('[WS] Disconnected');
      _notifyListeners('connection', {'state': 'disconnected'});
    });

    _socket!.onConnectError((error) {
      _state = WsConnectionState.error;
      debugPrint('[WS] Connect error: $error');
      _notifyListeners('connection', {'state': 'error', 'error': error});
    });

    _socket!.onReconnect((_) {
      _state = WsConnectionState.connected;
      debugPrint('[WS] Reconnected');
      _notifyListeners('connection', {'state': 'reconnected'});
    });

    // Listen for ALL events for debugging
    _socket!.onAny((event, data) {
      debugPrint('[WS] <<< EVENT: $event | data: $data');
    });

    _socket!.on(WsEvents.resultDelivered, (data) {
      debugPrint('[WS] resultDelivered received: $data');
      _notifyListeners(WsEvents.resultDelivered, data);
    });

    _socket!.on(WsEvents.resultProgress, (data) {
      _notifyListeners(WsEvents.resultProgress, data);
    });

    _socket!.on(WsEvents.statusChanged, (data) {
      debugPrint('[WS] statusChanged received: $data');
      _notifyListeners(WsEvents.statusChanged, data);
    });

    _socket!.on(WsEvents.commandAck, (data) {
      debugPrint('[WS] commandAck received: $data');
      _notifyListeners(WsEvents.commandAck, data);
    });

    _socket!.connect();
    debugPrint('[WS] connect() called, waiting...');
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _state = WsConnectionState.disconnected;
  }

  void sendCommand({
    required String requestId,
    required String targetDeviceId,
    required String action,
    String type = 'shell',
    int timeout = 30000,
  }) {
    debugPrint('[WS] >>> sendCommand: $requestId → $targetDeviceId: $action');
    _socket?.emitWithAck(WsEvents.commandSend, {
      'requestId': requestId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'data': {
        'commandId': requestId,
        'targetDeviceId': targetDeviceId,
        'type': type,
        'action': action,
        'timeout': timeout,
      },
    }, ack: (response) {
      debugPrint('[WS] <<< sendCommand ACK: $response (${response.runtimeType})');
      if (response is Map && response['success'] == false) {
        _notifyListeners(WsEvents.commandSendError, response);
      }
    });
  }

  void on(String event, Function(dynamic) callback) {
    _listeners.putIfAbsent(event, () => []);
    _listeners[event]!.add(callback);
  }

  void off(String event, [Function(dynamic)? callback]) {
    if (callback != null) {
      _listeners[event]?.remove(callback);
    } else {
      _listeners.remove(event);
    }
  }

  void _notifyListeners(String event, dynamic data) {
    final callbacks = _listeners[event];
    debugPrint('[WS] _notifyListeners($event): ${callbacks?.length ?? 0} listeners');
    if (callbacks != null) {
      for (final cb in callbacks) {
        cb(data);
      }
    }
  }
}

final wsServiceProvider = Provider<WsService>((ref) {
  final authRepo = ref.read(authRepositoryProvider);
  return WsService(authRepo: authRepo);
});
