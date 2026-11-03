import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class GeneratePayrollDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period: string;
}

export class UpdatePayrollItemDto {
  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  adjustmentKobo?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  deductionKobo?: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}
