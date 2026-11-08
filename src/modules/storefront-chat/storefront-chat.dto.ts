import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StartStorefrontChatDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(7) @MaxLength(30) phone: string;
  @ApiPropertyOptional() @Transform(trim) @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional({ enum: ['product', 'service', 'general'] }) @IsIn(['product', 'service', 'general']) @IsOptional() contextType?: 'product' | 'service' | 'general';
  @ApiPropertyOptional() @IsString() @IsOptional() contextId?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(160) contextName?: string;
}
export class SendStorefrontChatDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(3000) body: string;
}
