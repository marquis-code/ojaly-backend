import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  sign(businessId: string, purpose: string) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Image uploads are not configured yet. Add your Cloudinary keys.');
    }
    const base = this.config.get<string>('cloudinary.folder') || 'ojaly';
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `${base}/${businessId}/${purpose}`;
    const isVideo = purpose === 'video';
    const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);
    return {
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${isVideo ? 'video' : 'image'}/upload`,
      resourceType: isVideo ? 'video' : 'image',
      maxBytes: isVideo ? 50 * 1024 * 1024 : 8 * 1024 * 1024,
      allowedFormats: isVideo ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp'],
    };
  }

  async uploadPublicSupportAttachment(file: { buffer: Buffer; mimetype: string; size: number }) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (!cloudName || !apiKey || !apiSecret) throw new ServiceUnavailableException('File uploads are not configured yet.');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload.');
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const audio = ['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(file.mimetype);
    if (!image && !audio) throw new BadRequestException('Attach an image or a voice note.');
    if (file.size > (audio ? 15 : 5) * 1024 * 1024) throw new BadRequestException(audio ? 'Voice notes must be smaller than 15 MB.' : 'Images must be smaller than 5 MB.');
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    const base = this.config.get<string>('cloudinary.folder') || 'ojaly';
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `${base}/support`, resource_type: image ? 'image' : 'video', transformation: image ? [{ width: 1800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] : undefined },
        (error, uploaded) => error || !uploaded ? reject(error) : resolve(uploaded),
      );
      stream.end(file.buffer);
    });
    return { url: result.secure_url, type: image ? 'image' : 'audio' };
  }

  async uploadPublicRequestImage(file: { buffer: Buffer; mimetype: string; size: number }) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (!cloudName || !apiKey || !apiSecret) throw new ServiceUnavailableException('Photo uploads are not configured yet.');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a photo to upload.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Use a JPG, PNG or WebP photo.');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Photos must be smaller than 5 MB.');
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    const base = this.config.get<string>('cloudinary.folder') || 'ojaly';
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `${base}/custom-requests`, resource_type: 'image', transformation: [{ width: 1800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] },
        (error, uploaded) => error || !uploaded ? reject(error) : resolve(uploaded),
      );
      stream.end(file.buffer);
    });
    return {
      url: result.secure_url,
      optimizedUrl: result.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_1200/'),
    };
  }
}
