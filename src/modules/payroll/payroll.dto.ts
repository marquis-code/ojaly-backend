import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class GeneratePayrollDto {
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly', 'per_service'] })
  @IsIn(['daily', 'weekly', 'monthly', 'per_service'])
  frequency: 'daily' | 'weekly' | 'monthly' | 'per_service';

  @ApiProperty({ example: '2026-11-02' })
  @IsString()
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
