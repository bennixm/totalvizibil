import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

/** The display currencies a wallet can be shown in. Credits stay EUR-denominated. */
export const WALLET_CURRENCIES = ['EUR', 'RON'] as const;
export type WalletCurrency = (typeof WALLET_CURRENCIES)[number];

export class SetWalletCurrencyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(WALLET_CURRENCIES)
  currency!: WalletCurrency;
}
