import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CurrentBusiness } from '../../common/decorators/auth.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { UploadsService } from './uploads.service';

class SignUploadDto {
  @ApiProperty({ enum: ['products', 'logo', 'banner', 'receipts', 'avatar', 'expenses', 'lookbook', 'story', 'video'] })
  @IsIn(['products', 'logo', 'banner', 'receipts', 'avatar', 'expenses', 'lookbook', 'story', 'video'])
  purpose: 'products' | 'logo' | 'banner' | 'receipts' | 'avatar' | 'expenses' | 'lookbook' | 'story' | 'video';
}

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('public/support')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadSupportFile(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    return this.uploads.uploadPublicSupportAttachment(file);
  }

  @Post('public/custom-request')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadRequestPhoto(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number }) {
    if (!file) throw new BadRequestException('Choose a photo to upload.');
    return this.uploads.uploadPublicRequestImage(file);
  }

  @Post('sign')
  sign(@CurrentBusiness() businessId: string, @Body() dto: SignUploadDto) {
    return this.uploads.sign(businessId, dto.purpose);
  }
}
