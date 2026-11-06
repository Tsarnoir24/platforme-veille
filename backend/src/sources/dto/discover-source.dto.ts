import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DiscoverSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url!: string;
}
