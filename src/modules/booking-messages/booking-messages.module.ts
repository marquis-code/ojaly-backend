import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { BookingMessage, BookingMessageSchema } from './booking-message.schema';
import { BookingMessagesController, PublicBookingMessagesController } from './booking-messages.controller';
import { BookingMessagesService } from './booking-messages.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BookingMessage.name, schema: BookingMessageSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [BookingMessagesController, PublicBookingMessagesController],
  providers: [BookingMessagesService],
  exports: [BookingMessagesService],
})
export class BookingMessagesModule {}
