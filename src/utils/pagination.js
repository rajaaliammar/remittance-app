/**
 * Shared pagination helpers for list endpoints.
 * Supports `page` + `limit` or `offset` + `limit` query params.
 */

export function parsePaginationQuery(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const limit = Math.min(
    Math.max(parseInt(query.limit, 10) || defaultLimit, 1),
    maxLimit,
  );

  let offset;
  if (query.page != null && query.page !== '') {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    offset = (page - 1) * limit;
  } else {
    offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  }

  const page = Math.floor(offset / limit) + 1;

  return { take: limit, skip: offset, limit, offset, page };
}

export function parseSortQuery(query = {}, allowedFields = ['createdAt'], defaultField = 'createdAt') {
  const sortBy = allowedFields.includes(String(query.sortBy || ''))
    ? String(query.sortBy)
    : defaultField;
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { [sortBy]: sortOrder };
}

export function paginationMeta({ limit, offset, page, total }) {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    offset,
    total,
    totalPages,
    hasMore: offset + limit < total,
  };
}

export function sendPaginatedJson(res, { data, total, pagination, extra = {} }) {
  res.json({
    success: true,
    data,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    page: pagination.page,
    pagination: paginationMeta({ ...pagination, total }),
    ...extra,
  });
}
