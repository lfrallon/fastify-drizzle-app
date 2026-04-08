/**
 * The function `buildTodosCacheKey` generates a cache key based on provided parameters for ordering,
 * page size, and cursor information.
 * @param params - - orderBy: Specifies the order in which todos should be sorted, either in ascending
 * ("asc") or descending ("desc") order.
 * @returns The function `buildTodosCacheKey` returns a cache key string based on the provided
 * parameters. The cache key is constructed by concatenating the following parts with a pipe character
 * "|":
 */
export function buildTodosCacheKey(params: {
  orderBy: "asc" | "desc";
  clampedPageSize: number;
  cursor?: {
    id: string;
    updatedAt: string;
  };
}) {
  const { orderBy, clampedPageSize, cursor } = params;

  return [
    "todos:",
    `orderBy:${orderBy}`,
    `pageSize:${clampedPageSize}`,
    `cursorId:${cursor?.id ?? "none"}`,
    `cursorUpdatedAt:${cursor?.updatedAt ?? "none"}`,
  ].join("|");
}
