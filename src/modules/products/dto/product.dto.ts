import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ProductVariantDto {
  @ApiPropertyOptional({ example: 'Black / M' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'TSH-BLK-M' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({ example: { size: 'M', colour: 'Black' } })
  @IsObject()
  @IsOptional()
  attributes?: Record<string, string>;

  @ApiProperty({ example: 850000 })
  @IsInt()
  @Min(0)
  priceKobo: number;

  @ApiProperty({ example: 450000 })
  @IsInt()
  @Min(0)
  costPriceKobo: number;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsUrl({ require_protocol: true })
  @IsOptional()
  imageUrl?: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Oversized campus hoodie' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(3000)
  description?: string;

  @ApiPropertyOptional({ example: 'Hoodies' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ example: 'HOOD-001' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({ require_protocol: true }, { each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ example: 850000, description: 'Selling price in kobo, for products without variants' })
  @IsInt()
  @Min(0)
  @IsOptional()
  priceKobo?: number;

  @ApiPropertyOptional({ example: 450000, description: 'Cost price in kobo, for products without variants' })
  @IsInt()
  @Min(0)
  @IsOptional()
  costPriceKobo?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsInt()
  @Min(0)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional({ type: [ProductVariantDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => ProductVariantDto)
  @IsOptional()
  variants?: ProductVariantDto[];
}

export class DeleteProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids: string[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(3000)
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({ require_protocol: true }, { each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  costPriceKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class AddVariantDto extends ProductVariantDto {}

export class UpdateVariantDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  attributes?: Record<string, string>;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  priceKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  costPriceKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsUrl({ require_protocol: true })
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ProductQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ enum: ['all', 'active', 'inactive', 'low', 'out'] })
  @IsOptional()
  status?: 'all' | 'active' | 'inactive' | 'low' | 'out';

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

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}
