import { Hono } from 'hono'
import { SearchRequestSchema, SearchResponse, SearchResult, SuccessResponse } from '../../types/api.types.js'
import { requireScopes } from '../middleware/auth.js'
import { searchRateLimit } from '../middleware/rateLimit.js'
import { getSearchService } from '../../services/search.service.js'
import type { MetadataFilter } from '../../services/search.types.js'

const searchRouter = new Hono()
const searchService = getSearchService()

/**
 * POST / - Unified search endpoint
 * Supports vector, fulltext, and hybrid search modes
 */
searchRouter.post('/', requireScopes('read'), searchRateLimit, async (c) => {
  const startTime = Date.now()

  const body = await c.req.json()
  const validatedData = SearchRequestSchema.parse(body)

  const { q, containerTag, searchMode, limit, threshold, rerank, filters } = validatedData

  const metadataFilters: MetadataFilter[] | undefined = filters?.metadata
    ? Object.entries(filters.metadata)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        .map(([key, value]) => ({
          key,
          value: value as string | number | boolean,
          operator: 'eq',
        }))
    : undefined

  const dateRange =
    filters?.createdAfter || filters?.createdBefore
      ? {
          from: filters.createdAfter ? new Date(filters.createdAfter) : undefined,
          to: filters.createdBefore ? new Date(filters.createdBefore) : undefined,
        }
      : undefined

  const response = await searchService.hybridSearch(q, containerTag, {
    searchMode,
    limit,
    threshold,
    rerank,
    filters: metadataFilters,
    dateRange,
  })

  const results: SearchResult[] = response.results.map((result) => ({
    id: result.id,
    content: result.memory?.content ?? result.chunk?.content ?? '',
    score: result.rerankScore ?? result.similarity,
    containerTag: result.memory?.containerTag,
    metadata: result.metadata,
  }))

  const payload: SuccessResponse<SearchResponse> = {
    data: {
      results,
      total: response.totalCount,
      query: response.query,
      searchMode,
    },
    timing: Date.now() - startTime,
  }

  return c.json(payload)
})

export { searchRouter }
