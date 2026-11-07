import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SendBookingMessageDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(3000)
  @IsOptional()
  body?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(3)
  @IsUrl({ require_protocol: true }, { each: true })
  @IsOptional()
  attachments?: string[];
}
