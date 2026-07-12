import type { ParsedQs } from 'qs';

export function parsePagination(params: ParsedQs) {
  const page = Math.max(1, parseInt(params.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit as string) || 20));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function buildPaginationMeta(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}
