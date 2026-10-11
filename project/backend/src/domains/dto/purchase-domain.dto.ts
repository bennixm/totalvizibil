import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** A plain registrable domain — one dot, letters/digits/hyphens either side. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9]{2,24}$/i;

export class PurchaseDomainDto {
  @IsString()
  @MinLength(4)
  @MaxLength(253)
  @Matches(DOMAIN_RE, { message: 'Invalid domain' })
  domain!: string;
}
