import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { WaitlistService } from './waitlist.service';
import { UpdateWaitlistDto, WaitlistQueryDto } from './waitlist.dto';

@ApiTags('Waitlist')
@ApiBearerAuth()
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string, @Query() query: WaitlistQueryDto) {
    return this.waitlist.list(businessId, query);
  }

  @Post(':id/notify')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  notify(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.waitlist.notify(businessId, id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  status(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() body: UpdateWaitlistDto) {
    return this.waitlist.setStatus(businessId, id, body.status);
  }

  @Post(':id/refund')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  refund(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.waitlist.refundToWallet(businessId, id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  remove(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.waitlist.remove(businessId, id);
  }
}
