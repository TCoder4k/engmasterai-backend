import { Injectable } from '@nestjs/common';
import { DatasetMapper } from './mapper.interface';
import { GenericConfigMapper } from './generic-config.mapper';

@Injectable()
export class MapperRegistry {
  private readonly mappers = new Map<string, DatasetMapper>();

  constructor() {
    this.register(new GenericConfigMapper());
  }

  register(mapper: DatasetMapper): void {
    this.mappers.set(mapper.id, mapper);
  }

  get(id: string): DatasetMapper {
    const mapper = this.mappers.get(id);
    if (!mapper) {
      throw new Error(
        `Unknown mapper "${id}". Registered mappers: ${Array.from(this.mappers.keys()).join(', ')}`,
      );
    }
    return mapper;
  }
}
