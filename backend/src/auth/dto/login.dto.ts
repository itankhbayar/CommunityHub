import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;

  // no length rule on login: the only answer a wrong password gets is 401,
  // and a validation error here would leak the password policy
  @IsString()
  @MaxLength(128)
  password!: string;
}
