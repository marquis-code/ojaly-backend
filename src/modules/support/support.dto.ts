import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StartSupportConversationDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @Transform(trim) @IsEmail() email: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(7) @MaxLength(30) phone: string;
}

export class SupportAttachmentDto {
  @ApiProperty() @IsUrl({ require_protocol: true }) url: string;
  @ApiProperty({ enum: ['image', 'audio'] }) @IsIn(['image', 'audio']) type: 'image' | 'audio';
}

export class SendSupportMessageDto {
  @ApiPropertyOptional() @Transform(trim) @IsString() @MaxLength(3000) @IsOptional() body?: string;
  @ApiPropertyOptional({ type: [SupportAttachmentDto] }) @IsArray() @IsOptional() attachments?: SupportAttachmentDto[];
}
