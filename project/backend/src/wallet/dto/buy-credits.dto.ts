import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class BuyCreditsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  credits!: number;

  /** Pay with a card saved earlier (a Stripe PaymentMethod id of THIS
   *  user's customer). Omitted = the Stripe Checkout card form. */
  @IsOptional()
  @IsString()
  @Matches(/^pm_[A-Za-z0-9]+$/)
  paymentMethodId?: string;

  /** Checkout only: save the new card for future top-ups. */
  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;
}
