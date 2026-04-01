CREATE INDEX "map_messages_lat_lng_updated_at_idx" ON "map_messages" USING btree ("latitude","longitude","updated_at" desc);
