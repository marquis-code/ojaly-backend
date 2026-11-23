import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ReviewCategoryRatingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) @IsOptional() quality?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) @IsOptional() punctuality?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) @IsOptional() communication?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) @IsOptional() value?: number;
}

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional() @MaxLength(1000)
  comment?: string;

  @ApiPropertyOptional({ type: ReviewCategoryRatingsDto })
  @ValidateNested() @Type(() => ReviewCategoryRatingsDto) @IsOptional()
  categoryRatings?: ReviewCategoryRatingsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(40, { each: true }) @IsOptional()
  tags?: string[];

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional()
  wouldRecommend?: boolean;
}

export class ReplyReviewDto {
  @ApiProperty()
  @IsString() @MaxLength(1000)
  reply: string;
}

export class ReviewQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'published', 'pending', 'hidden'] })
  @IsIn(['all', 'published', 'pending', 'hidden'])
  @IsOptional()
  status?: string = 'all';
}

export class UpdateReviewDto {
  @ApiProperty({ enum: ['published', 'pending', 'hidden'] })
  @IsIn(['published', 'pending', 'hidden'])
  status: 'published' | 'pending' | 'hidden';
}
