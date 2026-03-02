// apps/server/src/upload/upload.service.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import * as crypto from 'crypto';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly maxFileSize = 5 * 1024 * 1024; // 5MB
  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  constructor(
    @Inject('MINIO_CLIENT') private readonly minioClient: MinioClient,
    private readonly configService: ConfigService,
  ) {}

  async uploadImage(file: Express.Multer.File, bucket: string): Promise<string> {
    // Validate file type
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('只支持 JPEG, PNG, GIF, WebP 格式的图片');
    }

    // Validate file size
    if (file.size > this.maxFileSize) {
      throw new BadRequestException('图片大小不能超过 5MB');
    }

    // Ensure bucket exists
    await this.ensureBucket(bucket);

    // Generate unique filename
    const fileName = this.generateFileName(file.originalname);

    // Upload to MinIO
    const metaData = {
      'Content-Type': file.mimetype,
    };
    await this.minioClient.putObject(
      bucket,
      fileName,
      file.buffer,
      file.size,
      metaData,
    );

    // Return URL
    const endpoint = this.configService.get('MINIO_ENDPOINT') || 'localhost';
    const port = this.configService.get('MINIO_PORT') || 9008;
    const useSSL = this.configService.get('MINIO_USE_SSL') === 'true';

    const protocol = useSSL ? 'https' : 'http';
    return `${protocol}://${endpoint}:${port}/${bucket}/${fileName}`;
  }

  private async ensureBucket(bucket: string): Promise<void> {
    const exists = await this.minioClient.bucketExists(bucket);
    if (!exists) {
      await this.minioClient.makeBucket(bucket);
    }
  }

  generateFileName(originalName: string): string {
    const ext = path.extname(originalName);
    const hash = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    return `${timestamp}-${hash}${ext}`;
  }
}
