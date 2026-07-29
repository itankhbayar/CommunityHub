import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Visibility } from '../../generated/prisma/enums';

export class CreateCommunityDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 80, { message: 'Name must be between 3 and 80 characters.' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description can be at most 500 characters.' })
  description?: string;

  @IsOptional()
  @IsEnum(Visibility, { message: 'Visibility must be PUBLIC or PRIVATE.' })
  visibility?: Visibility;
}
