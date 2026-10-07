import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from './api-error';

/** Validates and parses a request part with a shared @swag/protocol schema. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw ApiError.validation(z.prettifyError(result.error));
    return result.data;
  }
}

/** Parses a route param as a UUID. */
export const UuidParam = new ZodPipe(z.uuid());
