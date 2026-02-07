import { SQL } from "drizzle-orm";
import type { PgColumn, PgSelect } from "drizzle-orm/pg-core";

export function withPagination<T extends PgSelect>({
  orderByColumn,
  page = 1,
  pageSize = 3,
  qb,
}: {
  qb: T;
  orderByColumn: PgColumn | SQL | SQL.Aliased;
  page: number;
  pageSize: number;
}) {
  return qb
    .orderBy(orderByColumn)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}
