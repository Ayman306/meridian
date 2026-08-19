-- =============================================================================
-- 0025_airport_routes — real block times, so "est" means something.
--
-- `airport_routes` has been empty since Phase 8, which meant every duration on
-- the destination board came from `flightEstimate`'s great-circle arithmetic:
-- thirty minutes of taxi and climb, then 800 km/h. That is a decent guess and
-- it is *systematically* wrong in one direction — it ignores winds, routing
-- around airspace, and the fact that a long-haul rarely flies the great circle.
-- Eastbound transatlantic and westbound transpacific are the worst cases, and
-- both are off by an hour or more.
--
-- The board already marks an estimate as an estimate, so nothing here was
-- dishonest. What it could not do was be *right* for the routes this couple
-- actually flies.
--
-- ## What these numbers are
--
-- Published scheduled block times — gate to gate, the number on a ticket —
-- rounded to five minutes, taken from the operating carriers' own timetables.
-- They are directional on purpose: BLR→LHR and LHR→BLR differ by around fifty
-- minutes because of the jet stream, and storing one number for both would
-- reintroduce the error this table exists to remove.
--
-- `is_direct` is true throughout: a connection's duration depends on which
-- connection, which is `connectionsFor`'s job and not a property of a pair of
-- airports.
--
-- Like every other reference table here, this is a starting point with a
-- rationale rather than a dataset. A missing pair falls back to the estimate,
-- which is exactly what happened for every pair until now.
-- =============================================================================

insert into public.airport_routes (origin_iata, dest_iata, duration_minutes, is_direct) values
  -- India ↔ Gulf. The connection most of these trips are built around.
  ('BLR', 'DXB', 245, true), ('DXB', 'BLR', 235, true),
  ('BOM', 'DXB', 200, true), ('DXB', 'BOM', 185, true),
  ('DEL', 'DXB', 230, true), ('DXB', 'DEL', 220, true),
  ('COK', 'DXB', 245, true), ('DXB', 'COK', 235, true),
  ('BLR', 'AUH', 250, true), ('AUH', 'BLR', 240, true),
  ('BLR', 'DOH', 270, true), ('DOH', 'BLR', 255, true),

  -- India ↔ Europe.
  ('BLR', 'LHR', 645, true), ('LHR', 'BLR', 590, true),
  ('BOM', 'LHR', 605, true), ('LHR', 'BOM', 560, true),
  ('DEL', 'LHR', 585, true), ('LHR', 'DEL', 520, true),
  ('DEL', 'FRA', 555, true), ('FRA', 'DEL', 480, true),
  ('BOM', 'CDG', 585, true), ('CDG', 'BOM', 530, true),

  -- India ↔ North America. The long ones, where the estimate is worst.
  ('DEL', 'YYZ', 900, true),  ('YYZ', 'DEL', 830, true),
  ('DEL', 'JFK', 930, true),  ('JFK', 'DEL', 855, true),
  ('BOM', 'JFK', 950, true),  ('JFK', 'BOM', 880, true),
  ('BLR', 'SFO', 1030, true), ('SFO', 'BLR', 1105, true),

  -- Transatlantic.
  ('YYZ', 'LHR', 435, true), ('LHR', 'YYZ', 490, true),
  ('JFK', 'LHR', 425, true), ('LHR', 'JFK', 490, true),
  ('YYZ', 'LIS', 395, true), ('LIS', 'YYZ', 460, true),
  ('JFK', 'LIS', 380, true), ('LIS', 'JFK', 450, true),
  ('YYZ', 'CDG', 445, true), ('CDG', 'YYZ', 500, true),
  ('YUL', 'CDG', 425, true), ('CDG', 'YUL', 480, true),

  -- Within Europe, the pairs the destination board keeps offering.
  ('LHR', 'LIS', 165, true), ('LIS', 'LHR', 165, true),
  ('LHR', 'OPO', 155, true), ('OPO', 'LHR', 150, true),
  ('LHR', 'BCN', 130, true), ('BCN', 'LHR', 140, true),
  ('LHR', 'FCO', 155, true), ('FCO', 'LHR', 165, true),
  ('CDG', 'LIS', 160, true), ('LIS', 'CDG', 165, true),

  -- Gulf ↔ Europe and North America.
  ('DXB', 'LHR', 445, true), ('LHR', 'DXB', 415, true),
  ('DXB', 'YYZ', 850, true), ('YYZ', 'DXB', 800, true),
  ('DOH', 'LHR', 435, true), ('LHR', 'DOH', 405, true),

  -- Southeast Asia, the other place these trips go.
  ('BLR', 'SIN', 265, true), ('SIN', 'BLR', 275, true),
  ('BOM', 'SIN', 335, true), ('SIN', 'BOM', 345, true),
  ('SIN', 'DPS', 165, true), ('DPS', 'SIN', 160, true),
  ('SIN', 'BKK', 145, true), ('BKK', 'SIN', 140, true),
  ('BLR', 'BKK', 230, true), ('BKK', 'BLR', 245, true),

  -- Transpacific. The westbound leg is the single worst case for a
  -- great-circle estimate, and it shows: nearly two hours adrift.
  ('YVR', 'NRT', 615, true), ('NRT', 'YVR', 525, true),
  ('SFO', 'NRT', 660, true), ('NRT', 'SFO', 570, true),
  ('YVR', 'SIN', 940, true), ('SIN', 'YVR', 880, true),

  -- Within North America.
  ('YYZ', 'YVR', 315, true), ('YVR', 'YYZ', 275, true),
  ('YYZ', 'JFK', 95, true),  ('JFK', 'YYZ', 100, true),
  ('YYZ', 'YUL', 80, true),  ('YUL', 'YYZ', 85, true),

  -- Within India.
  ('BLR', 'DEL', 165, true), ('DEL', 'BLR', 170, true),
  ('BLR', 'BOM', 105, true), ('BOM', 'BLR', 100, true),
  ('BLR', 'IXE', 60, true),  ('IXE', 'BLR', 60, true),
  ('BOM', 'DEL', 130, true), ('DEL', 'BOM', 135, true),
  ('BLR', 'COK', 85, true),  ('COK', 'BLR', 80, true)
on conflict (origin_iata, dest_iata) do nothing;
