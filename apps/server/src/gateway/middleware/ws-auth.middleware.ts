import { Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

interface JwtPayload {
  sub: string;
  username: string;
}

export function createWsAuthMiddleware() {
  const publicKey = Buffer.from(
    process.env.AUTH_JWT_PUBLIC_KEY!,
    'base64',
  ).toString('utf-8');

  return (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('AUTH_MISSING: No token provided'));
      }

      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as JwtPayload;

      if (!payload.sub) {
        return next(new Error('AUTH_INVALID: Invalid token payload'));
      }

      socket.data.userId = payload.sub;
      socket.data.username = payload.username;
      socket.data.deviceType = socket.handshake.auth?.deviceType || 'web';
      socket.data.deviceId = socket.handshake.auth?.deviceId;

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(new Error('AUTH_EXPIRED: Token expired'));
      }
      return next(new Error('AUTH_INVALID: Token verification failed'));
    }
  };
}
