import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsHexColor, IsInt, IsOptional,
  IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BreakDto {
  @ApiProperty({ example: '13:00' })
  @Matches(timePattern)
  start: string;

  @ApiProperty({ example: '14:00' })
  @Matches(timePattern)
  end: string;
}

export class ProviderDayDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @ApiProperty()
  @IsBoolean()
  isWorking: boolean;

  @ApiProperty({ example: '09:00' })
  @Matches(timePattern)
  start: string;

  @ApiProperty({ example: '18:00' })
  @Matches(timePattern)
  end: string;

  @ApiPropertyOptional({ type: [BreakDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreakDto)
  @IsOptional()
  breaks?: BreakDto[];
}

export class TimeOffDto {
  @ApiProperty()
  @IsString()
  startAt: string;

  @ApiProperty()
  @IsString()
  endAt: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(160)
  reason?: string;
}

export class CreateProviderDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  avatarUrl?: string | null;

  @ApiPropertyOptional()
  @IsHexColor()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ type: [ProviderDayDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ProviderDayDto)
  @IsOptional()
  weeklySchedule?: ProviderDayDto[];

  @ApiPropertyOptional({ type: [TimeOffDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TimeOffDto)
  @IsOptional()
  timeOff?: TimeOffDto[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isBookable?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  salaryEnabled?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  monthlySalaryKobo?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(10)
  salaryStartDate?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  bankName?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  bankCode?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  accountNumber?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  accountName?: string | null;
}

export class UpdateProviderDto extends PartialType(CreateProviderDto) {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
