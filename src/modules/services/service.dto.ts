import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsHexColor, IsInt, IsOptional, IsString,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ServiceAddonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  priceKobo: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  @IsOptional()
  durationMinutes?: number;
}

export class CreateServiceDto {
  @ApiProperty({ example: 'Knotless braids' })
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(3000)
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsHexColor()
  @IsOptional()
  color?: string;

  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  @Max(1440)
  durationMinutes: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  showDuration?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  quantityEnabled?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(40)
  quantityLabel?: string;

  @ApiPropertyOptional()
  @IsInt() @Min(1) @Max(100)
  @IsOptional()
  minQuantity?: number;

  @ApiPropertyOptional()
  @IsInt() @Min(1) @Max(100)
  @IsOptional()
  maxQuantity?: number;

  @ApiPropertyOptional({ description: 'Worker pay per unit/job in kobo' })
  @IsInt() @Min(0)
  @IsOptional()
  workerPayKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  @IsOptional()
  bufferBeforeMinutes?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  @IsOptional()
  bufferAfterMinutes?: number;

  @ApiProperty({ example: 1500000 })
  @IsInt()
  @Min(0)
  priceKobo: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  depositKobo?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  requiresDeposit?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxBookingsPerSlot?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  providerIds?: string[];

  @ApiPropertyOptional({ type: [ServiceAddonDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ServiceAddonDto)
  @IsOptional()
  addOns?: ServiceAddonDto[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}
