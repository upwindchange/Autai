CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY,
	"thread_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_assignments" (
	"role" varchar PRIMARY KEY,
	"provider_id" varchar NOT NULL,
	"model_file" varchar NOT NULL,
	"params" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar PRIMARY KEY,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_tags" (
	"thread_id" varchar,
	"tag_id" integer,
	CONSTRAINT "thread_tags_pkey" PRIMARY KEY("thread_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" varchar PRIMARY KEY,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"status" text DEFAULT 'regular' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chat_provider_id" varchar,
	"chat_model_file" varchar,
	"chat_model_params" text
);
--> statement-breakpoint
CREATE TABLE "user_providers" (
	"id" varchar PRIMARY KEY,
	"provider_dir" varchar NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"api_url_override" text
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_assignments" ADD CONSTRAINT "model_assignments_provider_id_user_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "user_providers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_tag_id_tags_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_chat_provider_id_user_providers_id_fkey" FOREIGN KEY ("chat_provider_id") REFERENCES "user_providers"("id") ON DELETE SET NULL;