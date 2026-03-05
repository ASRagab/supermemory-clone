import { describe, expect, it } from 'vitest'
import {
  generateResourceList,
  RESOURCE_TEMPLATES,
  MAX_LISTED_RESOURCE_CONTAINERS,
  MAX_LISTED_RESOURCE_DOCUMENTS,
} from '../../src/mcp/resources.js'

describe('generateResourceList', () => {
  it('keeps the default resource list bounded for large datasets', () => {
    const containerTags = Array.from({ length: 20 }, (_, index) => `container-${index}`)
    const documentIds = Array.from({ length: 20 }, (_, index) => `doc-${index}`)

    const resources = generateResourceList(containerTags, documentIds)
    const profileResources = resources.filter((resource) => resource.uri.startsWith('memory://profiles/'))
    const factsResources = resources.filter((resource) => resource.uri.startsWith('memory://facts/'))
    const documentResources = resources.filter((resource) => resource.uri.startsWith('memory://documents/'))

    expect(profileResources).toHaveLength(MAX_LISTED_RESOURCE_CONTAINERS)
    expect(factsResources).toHaveLength(MAX_LISTED_RESOURCE_CONTAINERS)
    expect(documentResources).toHaveLength(MAX_LISTED_RESOURCE_DOCUMENTS)
    expect(resources).toHaveLength(2 + MAX_LISTED_RESOURCE_CONTAINERS * 2 + MAX_LISTED_RESOURCE_DOCUMENTS)
  })
})

describe('RESOURCE_TEMPLATES', () => {
  it('keeps the search and stats templates available for discovery', () => {
    const templateUris = RESOURCE_TEMPLATES.map((template) => template.uriTemplate)

    expect(templateUris).toContain('memory://search')
    expect(templateUris).toContain('memory://stats')
  })
})
