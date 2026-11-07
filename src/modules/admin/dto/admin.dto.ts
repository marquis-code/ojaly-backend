import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminUserQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['all', 'active', 'disabled', 'platform'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 25;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ['super_admin', 'support', null] })
  @IsIn(['super_admin', 'support', null])
  @IsOptional()
  platformRole?: 'super_admin' | 'support' | null;
}

export class AdminBusinessQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['all', 'published', 'unpublished', 'suspended', 'trial', 'paid'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 25;
}

export class ChangePlanDto {
  @ApiProperty()
  @IsString()
  planKey: string;

  @ApiPropertyOptional({ enum: ['monthly', 'yearly'] })
  @IsIn(['monthly', 'yearly'])
  @IsOptional()
  interval?: 'monthly' | 'yearly';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  note?: string;
}

export class ExtendTrialDto {
  @ApiProperty({ example: 14 })
  @IsInt()
  @Min(1)
  @Max(90)
  days: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planKey?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  note?: string;
}

export class SuspendBusinessDto {
  @ApiProperty()
  @IsBoolean()
  suspended: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

export class EntitlementsDto {
  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  productLimit?: number | null;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  staffSeats?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  customDomain?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  advancedReports?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  csvExport?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  pdfExport?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  embedWidget?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  whatsappBot?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  templates?: string[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  receiptBranding?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  prioritySupport?: boolean;
}

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MaxLength(30)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceMonthlyKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceYearlyKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  trialDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  trialMilestoneOrders?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isTrialPlan?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @Type(() => EntitlementsDto)
  @IsObject()
  @IsOptional()
  entitlements?: EntitlementsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  marketingFeatures?: string[];
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceMonthlyKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceYearlyKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  trialDays?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  trialMilestoneOrders?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isTrialPlan?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paystackPlanCodeMonthly?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  paystackPlanCodeYearly?: string | null;

  @ApiPropertyOptional()
  @Type(() => EntitlementsDto)
  @IsOptional()
  entitlements?: EntitlementsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  marketingFeatures?: string[];
}

export class CreateCouponDto {
  @ApiProperty({ example: 'STUDENT20' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  code: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  percentOff?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  amountOffKobo?: number;

  @ApiPropertyOptional({ enum: ['once', 'repeating', 'forever'] })
  @IsIn(['once', 'repeating', 'forever'])
  @IsOptional()
  duration?: 'once' | 'repeating' | 'forever';

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @IsOptional()
  durationMonths?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRedemptions?: number | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  grantedToBusinessId?: string;
}

export class AdminPaymentQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  purpose?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 25;
}

export class AuditQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  action?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  businessId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 30;
}

export class UpdateProviderFeeDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 'percent', enum: ['percent', 'fixed'] })
  @IsIn(['percent', 'fixed'])
  type: 'percent' | 'fixed';

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedKobo?: number;
}

export class UpdateServiceChargeDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 'percent', enum: ['percent', 'fixed'] })
  @IsIn(['percent', 'fixed'])
  type: 'percent' | 'fixed';

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedKobo?: number;
}


export class UpdatePlatformCampaignDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ minimum: 0, maximum: 100 }) @IsInt() @Min(0) @Max(100) percentOff: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsInt() @Min(0) @IsOptional() maxDiscountKobo?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(100) label?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) bannerText?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(40) badgeText?: string;
}

export class UpdateNewCustomerPromotionDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentOff: number;

  @ApiPropertyOptional({ example: 500000, description: 'Optional maximum discount in kobo' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxDiscountKobo?: number;
}
