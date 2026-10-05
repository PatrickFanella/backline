ALTER TABLE "AnnouncementSeries"
    DROP CONSTRAINT "AnnouncementSeries_state_check";
ALTER TABLE "AnnouncementSeries"
    ADD CONSTRAINT "AnnouncementSeries_state_check"
    CHECK("state" IN ('ACTIVE','PAUSED','CANCELLED','COMPLETED','HELD'));
