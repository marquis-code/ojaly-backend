import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { BookingMessagesService } from './booking-messages.service';
import { SendBookingMessageDto } from './booking-message.dto';

@ApiTags('Booking messages')
@Controller('booking-messages')
export class BookingMessagesController {
  constructor(private readonly messages: BookingMessagesService) {}

  @ApiBearerAuth()
  @Get('inbox')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  inbox(@CurrentBusiness() businessId: string) {
    return this.messages.inbox(businessId);
  }

  @ApiBearerAuth()
  @Get(':bookingId')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  thread(@CurrentBusiness() businessId: string, @Param('bookingId') bookingId: string) {
    return this.messages.vendorThread(businessId, bookingId);
  }

  @ApiBearerAuth()
  @Post(':bookingId')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  send(@CurrentBusiness() businessId: string, @Param('bookingId') bookingId: string, @Body() dto: SendBookingMessageDto) {
    return this.messages.sendVendor(businessId, bookingId, dto);
  }

  @ApiBearerAuth()
  @Post(':bookingId/read')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  read(@CurrentBusiness() businessId: string, @Param('bookingId') bookingId: string) {
    return this.messages.markVendorRead(businessId, bookingId);
  }
}

@ApiTags('Public booking messages')
@Public()
@Controller('public/booking-messages')
export class PublicBookingMessagesController {
  constructor(private readonly messages: BookingMessagesService) {}

  @Get(':token')
  thread(@Param('token') token: string) {
    return this.messages.publicThread(token);
  }

  @Post(':token')
  send(@Param('token') token: string, @Body() dto: SendBookingMessageDto) {
    return this.messages.sendCustomer(token, dto);
  }

  @Post(':token/read')
  read(@Param('token') token: string) {
    return this.messages.markCustomerRead(token);
  }
}
