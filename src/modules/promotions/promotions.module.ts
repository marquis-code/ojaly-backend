import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Promotion, PromotionSchema } from './promotion.schema';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Promotion.name, schema: PromotionSchema },
    { name: Booking.name, schema: BookingSchema },
    { name: Order.name, schema: OrderSchema },
  ])],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
