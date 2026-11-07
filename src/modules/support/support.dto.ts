import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StartSupportConversationDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @Transform(trim) @IsEmail() email: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(7) @MaxLength(30) phone: string;
}

export class SendSupportMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(3000) body: string;
}
