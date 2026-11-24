import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateWaitlistDto {
  @ApiProperty()
  @IsString()
  serviceId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  customerName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  customerPhone: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  @IsOptional()
  customerEmail?: string;

  @ApiProperty({ example: '2026-11-05' })
  @IsISO8601()
  preferredFrom: string;

  @ApiProperty({ example: '2026-11-12' })
  @IsISO8601()
  preferredTo: string;

  @ApiPropertyOptional({ description: 'Specific class/session time the customer wants' })
  @IsISO8601()
  @IsOptional()
  preferredStartAt?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Hostel or location' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ description: 'Room or unit number' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  roomNumber?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  days?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  quantity?: number;
}

export class UpdateWaitlistDto {
  @ApiProperty({ enum: ['waiting', 'notified', 'booked', 'cancelled'] })
  @IsIn(['waiting', 'notified', 'booked', 'cancelled'])
  status: 'waiting' | 'notified' | 'booked' | 'cancelled';
}

export class WaitlistQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'waiting', 'notified', 'booked', 'cancelled'] })
  @IsIn(['all', 'waiting', 'notified', 'booked', 'cancelled'])
  @IsOptional()
  status?: string = 'all';
}
