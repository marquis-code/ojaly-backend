import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SaleAttachmentDto {
  @IsUrl({ require_protocol: true }) url: string;
  @IsIn(['image', 'audio']) type: 'image' | 'audio';
}

export class SendSaleMessageDto {
  @ApiPropertyOptional() @Transform(trim) @IsString() @MaxLength(3000) @IsOptional() body?: string;
  @ApiPropertyOptional({ type: [SaleAttachmentDto] }) @IsArray() @ArrayMaxSize(3) @IsOptional() attachments?: SaleAttachmentDto[];
}
