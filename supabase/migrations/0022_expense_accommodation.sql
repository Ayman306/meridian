-- =============================================================================
-- 0022_expense_accommodation — what the hotel cost.
--
-- `expenses` could already point at a trip and at an itinerary item. It could
-- not point at a stay, so the single largest line on most trips — the room —
-- was the one thing you could not trace back to what you booked.
--
-- `on delete set null` rather than cascade, deliberately: removing a booking
-- must never remove the money that was spent on it. The expense outlives the
-- reservation, which is the whole reason it is recorded.
-- =============================================================================

alter table public.expenses
  add column if not exists accommodation_id uuid
    references public.accommodations(id) on delete set null;

create index if not exists expenses_accommodation_idx
  on public.expenses (accommodation_id) where accommodation_id is not null;

comment on column public.expenses.accommodation_id is
  'The booking this paid for. Set null rather than cascaded when the booking goes, because the money was still spent.';
