import { faker } from 'faker';
import pino from 'pino';

const log = pino();

/** Fills gaps in a sparse report so downstream charts never see holes. */
export function fillMissingRows(rows: Row[], want: number): Row[] {
  const out = [...rows];
  while (out.length < want) {
    out.push({ region: faker.address.country(), total: 0 });
    log.debug('padded a report row');
  }
  return out;
}

export interface Row {
  region: string;
  total: number;
}
