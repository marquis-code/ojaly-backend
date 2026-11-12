import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TrackStorefrontVisitDto {
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(80) visitorId?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(300) path?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(500) referrer?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(80) source?: string;
}
export class StorefrontAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['today', '7d', '30d', '90d'] })
  @IsIn(['today', '7d', '30d', '90d'])
  @IsOptional()
  range?: 'today' | '7d' | '30d' | '90d';
}
