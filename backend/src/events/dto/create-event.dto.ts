import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 120, { message: 'Title must be between 3 and 120 characters.' })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Description can be at most 2000 characters.' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsDateString({}, { message: 'startsAt must be an ISO 8601 date.' })
  startsAt!: string;

  @IsOptional()
  @IsDateString({}, { message: 'endsAt must be an ISO 8601 date.' })
  endsAt?: string;

  /** omitted or null = unlimited */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Capacity must be at least 1.' })
  @Max(100_000)
  capacity?: number;
}
