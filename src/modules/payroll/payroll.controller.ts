import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PayrollService } from './payroll.service';
import { GeneratePayrollDto, UpdatePayrollItemDto } from './payroll.dto';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('runs')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  list(@CurrentBusiness() businessId: string) {
    return this.payroll.list(businessId);
  }

  @Post('runs')
  @Permissions(PERMISSIONS.PAYROLL_WRITE)
  generate(@CurrentBusiness() businessId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: GeneratePayrollDto) {
    return this.payroll.generate(businessId, dto.period, user.id);
  }

  @Get('runs/:id')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  get(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.payroll.get(businessId, id);
  }

  @Patch('runs/:id/items/:providerId')
  @Permissions(PERMISSIONS.PAYROLL_WRITE)
  updateItem(@CurrentBusiness() businessId: string, @Param('id') id: string, @Param('providerId') providerId: string, @Body() dto: UpdatePayrollItemDto) {
    return this.payroll.updateItem(businessId, id, providerId, dto);
  }

  @Post('runs/:id/approve')
  @Permissions(PERMISSIONS.PAYROLL_WRITE)
  approve(@CurrentBusiness() businessId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payroll.approve(businessId, id, user.id);
  }

  @Post('runs/:id/pay')
  @Permissions(PERMISSIONS.PAYROLL_WRITE)
  pay(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.payroll.pay(businessId, id);
  }

  @Post('runs/:id/verify')
  @Permissions(PERMISSIONS.PAYROLL_READ)
  verify(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.payroll.verify(businessId, id);
  }

  @Post('runs/:id/cancel')
  @Permissions(PERMISSIONS.PAYROLL_WRITE)
  cancel(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.payroll.cancel(businessId, id);
  }
}
