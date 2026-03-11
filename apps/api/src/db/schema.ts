import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";

export const roomStatusEnum = pgEnum("room_status", [
  "active",
  "ended",
  "processing",
  "done",
]);

export const summaryStatusEnum = pgEnum("summary_status", [
  "pending",
  "paid",
  "processing",
  "sent",
  "failed",
]);

export const paymentProviderEnum = pgEnum("payment_provider", [
  "stripe",
  "yookassa",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "cancelled",
  "expired",
]);

export const rooms = pgTable("rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  hostName: text("host_name").notNull(),
  hostEmail: text("host_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  participantCount: integer("participant_count").default(0).notNull(),
  durationMinutes: integer("duration_minutes"),
  recordingUrl: text("recording_url"),
  status: roomStatusEnum("status").default("active").notNull(),
  isPaidHost: boolean("is_paid_host").default(false).notNull(),
});

export const participants = pgTable("participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  name: text("name").notNull(),
  trackId: text("track_id"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  leftAt: timestamp("left_at"),
});

export const summaryOrders = pgTable("summary_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  email: text("email").notNull(),
  paymentProvider: paymentProviderEnum("payment_provider"),
  paymentId: text("payment_id"),
  creditsUsed: integer("credits_used"),
  status: summaryStatusEnum("status").default("pending").notNull(),
  transcriptUrl: text("transcript_url"),
  summaryText: text("summary_text"),
  sentAt: timestamp("sent_at"),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  paymentProvider: paymentProviderEnum("payment_provider").notNull(),
  subscriptionId: text("subscription_id").notNull(),
  status: subscriptionStatusEnum("status").default("active").notNull(),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
});
