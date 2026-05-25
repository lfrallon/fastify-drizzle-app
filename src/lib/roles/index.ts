export function buildUserRolesCacheKey(params: {
  userId: string;
  orderBy: "asc" | "desc";
  clampedPageSize: number;
  cursor?: {
    id: string;
    updatedAt: string;
  };
}) {
  const { userId, orderBy, clampedPageSize, cursor } = params;

  return [
    "user:roles",
    `userId:${userId}`,
    `orderBy:${orderBy}`,
    `pageSize:${clampedPageSize}`,
    `cursorId:${cursor?.id ?? "none"}`,
    `cursorUpdatedAt:${cursor?.updatedAt ?? "none"}`,
  ].join("|");
}
