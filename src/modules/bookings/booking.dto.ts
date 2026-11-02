import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional,
  IsString, Max, MaxLength, Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  serviceId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiProperty({ example: '2026-11-02T10:00:00.000Z' })
  @IsISO8601()
  startAt: string;

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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Campus marketplace attribution, e.g. UNILAG' })
  @IsString()
  @IsOptional()
  marketplaceCampus?: string;

  @ApiPropertyOptional({ description: 'Prepaid package redemption code' })
  @IsString()
  @IsOptional()
  packageCode?: string;

  @ApiPropertyOptional({ type: [String], description: 'Names of selected add-ons' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  addOnNames?: string[];
}

export class CreatePublicBookingDto extends CreateBookingDto {}

export class CreateRecurringBookingDto extends CreateBookingDto {
  @ApiProperty({ enum: ['weekly', 'biweekly', 'monthly'] })
  @IsIn(['weekly', 'biweekly', 'monthly'])
  frequency: 'weekly' | 'biweekly' | 'monthly';

  @ApiProperty({ minimum: 2, maximum: 12, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  occurrences: number;
}

export class RescheduleBookingDto {
  @ApiProperty({ example: '2026-11-03T12:00:00.000Z' })
  @IsISO8601()
  startAt: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;
}

export class RefundBookingDto {
  @ApiPropertyOptional({ description: 'Amount in kobo. Omit for the full refundable balance.' })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @IsOptional()
  amountKobo?: number;
}

export class CancelBookingDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class BookingStatusDto {
  @ApiProperty({ enum: ['confirmed', 'completed', 'cancelled', 'no_show'] })
  @IsIn(['confirmed', 'completed', 'cancelled', 'no_show'])
  status: 'confirmed' | 'completed' | 'cancelled' | 'no_show';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class BookingQueryDto {
  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  date?: string;

  @ApiPropertyOptional()
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional()
  @IsISO8601()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ enum: ['all', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show'] })
  @IsIn(['all', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show'])
  @IsOptional()
  status?: string = 'all';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit = 100;
}

export class AvailabilityQueryDto {
  @ApiProperty()
  @IsString()
  serviceId: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsString()
  date: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional({ description: 'Override duration in minutes, including selected add-ons' })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  @IsOptional()
  durationMinutes?: number;
}

export class BookingMetricsQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'last_month', 'custom'] })
  @IsIn(['today', 'week', 'month', 'last_month', 'custom'])
  @IsOptional()
  range?: 'today' | 'week' | 'month' | 'last_month' | 'custom';

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsString()
  @IsOptional()
  to?: string;
}

export class LookupBookingDto {
  @ApiProperty()
  @IsString()
  customerPhone: string;

  @ApiProperty()
  @IsString()
  bookingNumber: string;
}
