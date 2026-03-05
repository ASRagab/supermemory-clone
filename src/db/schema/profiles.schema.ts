import { pgTable, uuid, varchar, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { containerTags } from './containers.schema.js'

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    containerTag: varchar('container_tag', { length: 255 })
      .notNull()
      .unique()
      .references(() => containerTags.tag, { onDelete: 'cascade' }),
    staticFacts: jsonb('static_facts').default(sql`'[]'::jsonb`),
    dynamicFacts: jsonb('dynamic_facts').default(sql`'[]'::jsonb`),
    preferences: jsonb('preferences').default(sql`'{}'::jsonb`),
    computedTraits: jsonb('computed_traits').default(sql`'{}'::jsonb`),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    memoryCount: integer('memory_count').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_profiles_container').on(table.containerTag),
    index('idx_user_profiles_static_facts').using('gin', table.staticFacts),
    index('idx_user_profiles_dynamic_facts').using('gin', table.dynamicFacts),
    index('idx_user_profiles_preferences').using('gin', table.preferences),
    index('idx_user_profiles_updated').on(table.updatedAt.desc()),
  ]
)

export type UserProfile = typeof userProfiles.$inferSelect
export type NewUserProfile = typeof userProfiles.$inferInsert
