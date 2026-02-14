import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@Injectable()
export class AuthService {
  private readonly jwtPrivateKey: string;
  private readonly jwtPublicKey: string;
  private readonly refreshPrivateKey: string;
  private readonly refreshPublicKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.jwtPrivateKey = Buffer.from(
      process.env.AUTH_JWT_PRIVATE_KEY!,
      'base64',
    ).toString('utf-8');
    this.jwtPublicKey = Buffer.from(
      process.env.AUTH_JWT_PUBLIC_KEY!,
      'base64',
    ).toString('utf-8');
    this.refreshPrivateKey = Buffer.from(
      process.env.AUTH_REFRESH_PRIVATE_KEY!,
      'base64',
    ).toString('utf-8');
    this.refreshPublicKey = Buffer.from(
      process.env.AUTH_REFRESH_PUBLIC_KEY!,
      'base64',
    ).toString('utf-8');
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Email already registered'
          : 'Username already taken',
      );
    }

    const hashedPassword = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        password: hashedPassword,
        displayName: dto.displayName,
      },
    });

    const tokens = await this.generateTokenPair(user.id, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await argon2.verify(user.password, dto.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokenPair(user.id, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      ...tokens,
    };
  }

  async refresh(dto: RefreshDto) {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        algorithms: ['RS256'],
        publicKey: this.refreshPublicKey,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Token Rotation: delete old, generate new
    await this.prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });

    const tokens = await this.generateTokenPair(user.id, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken
      .delete({ where: { token: refreshToken } })
      .catch(() => {
        // Token already deleted or doesn't exist — safe to ignore
      });
    return { success: true };
  }

  private async generateTokenPair(userId: string, username: string) {
    const jti = crypto.randomUUID();

    const accessExpiresIn = process.env.AUTH_JWT_TOKEN_EXPIRES_IN || '15m';
    const refreshExpiresIn =
      process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN || '30d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, username, jti },
        {
          algorithm: 'RS256',
          privateKey: this.jwtPrivateKey,
          expiresIn: accessExpiresIn as any,
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, type: 'refresh', jti: crypto.randomUUID() },
        {
          algorithm: 'RS256',
          privateKey: this.refreshPrivateKey,
          expiresIn: refreshExpiresIn as any,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }
}
