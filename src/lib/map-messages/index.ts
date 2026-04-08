/**
 * The `parseBboxString` function in TypeScript parses a string representing bounding box coordinates
 * into an object with west, south, east, and north properties.
 * @param {string} bbox - A string representing a bounding box in the format "west,south,east,north".
 * @returns The function `parseBboxString` is returning an object with properties `west`, `south`,
 * `east`, and `north`, each representing a numerical value parsed from the input `bbox` string. If the
 * input string cannot be parsed correctly or does not contain exactly 4 valid numerical values
 * separated by commas, the function returns `null`.
 */
export function parseBboxString(bbox: string) {
  const values = bbox.split(",").map((value) => Number(value.trim()));

  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
    return null;
  }

  const [west, south, east, north] = values;

  return {
    west,
    south,
    east,
    north,
  };
}

/**
 * The function `buildMapMessagesCacheKey` generates a cache key based on input parameters for map
 * messages.
 * @param params - The `buildMapMessagesCacheKey` function takes in an object `params` with the
 * following properties:
 * @returns The function `buildMapMessagesCacheKey` returns a cache key string based on the provided
 * parameters. The cache key includes information such as the order by value, clamped page size, cursor
 * id and updated at values (if provided), and bbox filter values (if provided). The cache key is
 * constructed by joining these values with specific prefixes using the pipe character "|".
 */
export function buildMapMessagesCacheKey(params: {
  orderBy: "asc" | "desc";
  clampedPageSize: number;
  cursor?: {
    id: string;
    updatedAt: string;
  };
  bboxFilter?: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
}) {
  const { orderBy, clampedPageSize, cursor, bboxFilter } = params;

  return [
    "mapMessages:",
    `orderBy:${orderBy}`,
    `pageSize:${clampedPageSize}`,
    `cursorId:${cursor?.id ?? "none"}`,
    `cursorUpdatedAt:${cursor?.updatedAt ?? "none"}`,
    `west:${bboxFilter?.west ?? "none"}`,
    `south:${bboxFilter?.south ?? "none"}`,
    `east:${bboxFilter?.east ?? "none"}`,
    `north:${bboxFilter?.north ?? "none"}`,
  ].join("|");
}
