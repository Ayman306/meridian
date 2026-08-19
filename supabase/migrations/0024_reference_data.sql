-- =============================================================================
-- 0024_reference_data — widen the two seeds that were openly starting points.
--
-- Both of these were shipped as small, deliberately conservative sets with
-- sources attached and a `verified_on` date, and both were recorded as gaps
-- because a starting point that never grows is just a gap with a citation.
--
-- ## What is still true after this
--
-- These are **not** a dataset. They are more rows of the same kind: each with
-- a source link and a checked-on date, each rendered behind the same advisory
-- wording, and each now carrying a staleness marker once it passes six months
-- (see `lib/advisory.ts`). Nobody should board a plane on the strength of a row
-- in here without opening its source, and every surface says so.
--
-- Airports are different in kind — a coordinate and an IATA code are facts that
-- do not change — so those are simply more of them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Medication restrictions.
--
-- Chosen by the failure they prevent: each is something routinely carried and
-- legal at home, whose seizure at a border would derail a trip. A row that says
-- "cocaine is illegal" would be true and useless.
-- -----------------------------------------------------------------------------
insert into public.medication_restrictions
  (country_code, substance, restriction, source_url, verified_on)
values
  -- Japan — the strictest common case, and the one that catches ordinary
  -- cold remedies and prescribed ADHD medication.
  ('JP', 'methylphenidate', 'Prohibited, including prescribed ADHD medicines such as Ritalin and Concerta',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-19'),
  ('JP', 'oxycodone', 'Requires a Yakkan Shoumei import certificate obtained before travel',
   'https://www.mhlw.go.jp/english/policy/health-medical/pharmaceuticals/01.html', '2026-08-19'),

  -- United Arab Emirates — a long controlled list, and transit counts.
  ('AE', 'diazepam', 'Controlled — prior approval and a prescription are required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-19'),
  ('AE', 'methylphenidate', 'Controlled — prior approval and a prescription are required',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-19'),
  ('AE', 'pseudoephedrine', 'Restricted — carry the original packaging and a prescription',
   'https://mohap.gov.ae/en/services/import-medicines-for-personal-use', '2026-08-19'),

  -- Singapore.
  ('SG', 'diazepam', 'Controlled — carry a prescription; approval needed for larger quantities',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-19'),
  ('SG', 'methylphenidate', 'Controlled — approval needed before arrival',
   'https://www.hsa.gov.sg/personal-medication', '2026-08-19'),

  -- India.
  ('IN', 'codeine', 'Controlled — carry a prescription',
   'https://cdsco.gov.in/opencms/opencms/en/Home/', '2026-08-19'),
  ('IN', 'cannabidiol', 'Restricted — legality depends on THC content and state law',
   'https://cdsco.gov.in/opencms/opencms/en/Home/', '2026-08-19'),

  -- United Kingdom.
  ('GB', 'codeine', 'Controlled — carry a prescription and a letter for trips over three months',
   'https://www.gov.uk/travelling-controlled-drugs', '2026-08-19'),
  ('GB', 'methylphenidate', 'Controlled — carry a prescription and a letter for trips over three months',
   'https://www.gov.uk/travelling-controlled-drugs', '2026-08-19'),

  -- United States.
  ('US', 'tramadol', 'Schedule IV — carry it in its original labelled container',
   'https://www.dea.gov/drug-information/drug-scheduling', '2026-08-19'),
  ('US', 'cannabidiol', 'Federally restricted above 0.3% THC, and prohibited by TSA above that',
   'https://www.tsa.gov/travel/security-screening/whatcanibring/items/medical-marijuana', '2026-08-19'),

  -- Schengen states people most often connect through.
  ('DE', 'codeine', 'Controlled — carry a prescription; a Schengen certificate is needed over 30 days',
   'https://www.bfarm.de/EN/Federal-Opium-Agency/_node.html', '2026-08-19'),
  ('FR', 'codeine', 'Controlled — carry a prescription; a Schengen certificate is needed over 30 days',
   'https://ansm.sante.fr/', '2026-08-19'),
  ('NL', 'cannabidiol', 'Permitted below 0.05% THC; above that it is a controlled substance',
   'https://www.government.nl/topics/drugs', '2026-08-19'),

  -- Others that regularly surprise people.
  ('TR', 'pseudoephedrine', 'Restricted — carry the original packaging and a prescription',
   'https://www.titck.gov.tr/', '2026-08-19'),
  ('TH', 'tramadol', 'Controlled — carry a prescription, with a 30-day personal supply limit',
   'https://www.fda.moph.go.th/sites/en/Pages/Main.aspx', '2026-08-19'),
  ('QA', 'codeine', 'Controlled — prior approval required, and transit counts as entry',
   'https://www.moph.gov.qa/english/Pages/default.aspx', '2026-08-19'),
  ('AU', 'pseudoephedrine', 'Restricted — declare it and carry a prescription',
   'https://www.tga.gov.au/products/medicines/travelling-medicines-and-medical-devices', '2026-08-19'),
  ('CA', 'cannabidiol', 'Prohibited to carry across the border in either direction, legal or not',
   'https://www.canada.ca/en/health-canada/services/drugs-medication/cannabis/laws-regulations.html', '2026-08-19')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Airports.
--
-- An airport missing from this table saves fine and carries no coordinates, so
-- the map cannot draw that leg and the layover minimum falls back to the
-- international one. Both are silent degradations, which is what makes the list
-- worth widening rather than leaving to be noticed.
--
-- Coordinates are published airport reference points; timezones are IANA names,
-- because a fixed offset is wrong twice a year.
-- -----------------------------------------------------------------------------
insert into public.airports (iata, icao, name, city, country_code, lat, lng, timezone) values
  -- India, beyond the metros
  ('IXE', 'VOML', 'Mangaluru International',            'Mangalore',    'IN', 12.9613,  74.8901, 'Asia/Kolkata'),
  ('CCJ', 'VOCL', 'Calicut International',              'Kozhikode',    'IN', 11.1368,  75.9553, 'Asia/Kolkata'),
  ('TRV', 'VOTV', 'Trivandrum International',           'Thiruvananthapuram', 'IN', 8.4821, 76.9201, 'Asia/Kolkata'),
  ('IXM', 'VOMD', 'Madurai',                            'Madurai',      'IN',  9.8345,  78.0934, 'Asia/Kolkata'),
  ('VTZ', 'VOVZ', 'Visakhapatnam',                      'Visakhapatnam','IN', 17.7211,  83.2245, 'Asia/Kolkata'),
  ('IXC', 'VICG', 'Chandigarh',                         'Chandigarh',   'IN', 30.6735,  76.7885, 'Asia/Kolkata'),
  ('IXB', 'VEBD', 'Bagdogra',                           'Siliguri',     'IN', 26.6812,  88.3286, 'Asia/Kolkata'),
  ('IXJ', 'VIJU', 'Jammu',                              'Jammu',        'IN', 32.6891,  74.8374, 'Asia/Kolkata'),
  ('IXL', 'VILH', 'Kushok Bakula Rimpochee',            'Leh',          'IN', 34.1359,  77.5465, 'Asia/Kolkata'),
  ('STV', 'VASU', 'Surat',                              'Surat',        'IN', 21.1141,  72.7418, 'Asia/Kolkata'),
  ('BDQ', 'VABO', 'Vadodara',                           'Vadodara',     'IN', 22.3362,  73.2263, 'Asia/Kolkata'),
  ('IDR', 'VAID', 'Devi Ahilya Bai Holkar',             'Indore',       'IN', 22.7218,  75.8011, 'Asia/Kolkata'),
  ('NAG', 'VANP', 'Dr. Babasaheb Ambedkar',             'Nagpur',       'IN', 21.0922,  79.0472, 'Asia/Kolkata'),
  ('PNQ', 'VAPO', 'Pune',                               'Pune',         'IN', 18.5822,  73.9197, 'Asia/Kolkata'),
  ('CJB', 'VOCB', 'Coimbatore International',           'Coimbatore',   'IN', 11.0301,  77.0434, 'Asia/Kolkata'),

  -- Canada, beyond Toronto and Vancouver
  ('YOW', 'CYOW', 'Ottawa Macdonald–Cartier',           'Ottawa',       'CA', 45.3225, -75.6692, 'America/Toronto'),
  ('YHZ', 'CYHZ', 'Halifax Stanfield',                  'Halifax',      'CA', 44.8808, -63.5086, 'America/Halifax'),
  ('YEG', 'CYEG', 'Edmonton International',             'Edmonton',     'CA', 53.3097,-113.5801, 'America/Edmonton'),
  ('YQB', 'CYQB', 'Québec City Jean Lesage',            'Quebec City',  'CA', 46.7911, -71.3933, 'America/Toronto'),
  ('YWG', 'CYWG', 'Winnipeg Richardson',                'Winnipeg',     'CA', 49.9100, -97.2399, 'America/Winnipeg'),
  ('YYT', 'CYYT', 'St. John''s International',          'St. John''s',  'CA', 47.6186, -52.7519, 'America/St_Johns'),

  -- United States, common connections
  ('BOS', 'KBOS', 'Logan International',                'Boston',       'US', 42.3656, -71.0096, 'America/New_York'),
  ('IAD', 'KIAD', 'Washington Dulles',                  'Washington',   'US', 38.9531, -77.4565, 'America/New_York'),
  ('PHL', 'KPHL', 'Philadelphia International',         'Philadelphia', 'US', 39.8729, -75.2437, 'America/New_York'),
  ('MSP', 'KMSP', 'Minneapolis–Saint Paul',             'Minneapolis',  'US', 44.8848, -93.2223, 'America/Chicago'),
  ('DTW', 'KDTW', 'Detroit Metropolitan',               'Detroit',      'US', 42.2124, -83.3534, 'America/Detroit'),
  ('CLT', 'KCLT', 'Charlotte Douglas',                  'Charlotte',    'US', 35.2140, -80.9431, 'America/New_York'),
  ('AUS', 'KAUS', 'Austin–Bergstrom',                   'Austin',       'US', 30.1975, -97.6664, 'America/Chicago'),
  ('SAN', 'KSAN', 'San Diego International',            'San Diego',    'US', 32.7336,-117.1897, 'America/Los_Angeles'),
  ('PDX', 'KPDX', 'Portland International',             'Portland',     'US', 45.5898,-122.5951, 'America/Los_Angeles'),
  ('SLC', 'KSLC', 'Salt Lake City International',       'Salt Lake City','US',40.7899,-111.9791, 'America/Denver'),

  -- Europe, beyond the majors
  ('OPO', 'LPPR', 'Francisco Sá Carneiro',              'Porto',        'PT', 41.2481,  -8.6814, 'Europe/Lisbon'),
  ('FAO', 'LPFR', 'Faro',                               'Faro',         'PT', 37.0144,  -7.9659, 'Europe/Lisbon'),
  ('VLC', 'LEVC', 'Valencia',                           'Valencia',     'ES', 39.4893,  -0.4816, 'Europe/Madrid'),
  ('SVQ', 'LEZL', 'Sevilla',                            'Seville',      'ES', 37.4180,  -5.8931, 'Europe/Madrid'),
  ('AGP', 'LEMG', 'Málaga–Costa del Sol',               'Malaga',       'ES', 36.6749,  -4.4991, 'Europe/Madrid'),
  ('NAP', 'LIRN', 'Naples International',               'Naples',       'IT', 40.8860,  14.2908, 'Europe/Rome'),
  ('VCE', 'LIPZ', 'Venice Marco Polo',                  'Venice',       'IT', 45.5053,  12.3519, 'Europe/Rome'),
  ('FLR', 'LIRQ', 'Florence Peretola',                  'Florence',     'IT', 43.8100,  11.2051, 'Europe/Rome'),
  ('KRK', 'EPKK', 'Kraków John Paul II',                'Krakow',       'PL', 50.0777,  19.7848, 'Europe/Warsaw'),
  ('BUD', 'LHBP', 'Budapest Ferenc Liszt',              'Budapest',     'HU', 47.4369,  19.2556, 'Europe/Budapest'),
  ('OTP', 'LROP', 'Henri Coandă',                       'Bucharest',    'RO', 44.5711,  26.0850, 'Europe/Bucharest'),
  ('EDI', 'EGPH', 'Edinburgh',                          'Edinburgh',    'GB', 55.9500,  -3.3725, 'Europe/London'),
  ('MAN', 'EGCC', 'Manchester',                         'Manchester',   'GB', 53.3537,  -2.2750, 'Europe/London'),
  ('BRS', 'EGGD', 'Bristol',                            'Bristol',      'GB', 51.3827,  -2.7191, 'Europe/London'),

  -- Asia-Pacific and the Gulf
  ('CGK', 'WIII', 'Soekarno–Hatta',                     'Jakarta',      'ID', -6.1256, 106.6559, 'Asia/Jakarta'),
  ('DPS', 'WADD', 'Ngurah Rai',                         'Denpasar',     'ID', -8.7482, 115.1672, 'Asia/Makassar'),
  ('MNL', 'RPLL', 'Ninoy Aquino International',         'Manila',       'PH', 14.5086, 121.0198, 'Asia/Manila'),
  ('CEB', 'RPVM', 'Mactan–Cebu International',          'Cebu',         'PH', 10.3075, 123.9794, 'Asia/Manila'),
  ('HAN', 'VVNB', 'Noi Bai International',              'Hanoi',        'VN', 21.2212, 105.8072, 'Asia/Ho_Chi_Minh'),
  ('SGN', 'VVTS', 'Tan Son Nhat',                       'Ho Chi Minh City','VN',10.8188,106.6520,'Asia/Ho_Chi_Minh'),
  ('CMB', 'VCBI', 'Bandaranaike International',         'Colombo',      'LK',  7.1808,  79.8841, 'Asia/Colombo'),
  ('KTM', 'VNKT', 'Tribhuvan International',            'Kathmandu',    'NP', 27.6966,  85.3591, 'Asia/Kathmandu'),
  ('MLE', 'VRMM', 'Velana International',               'Male',         'MV',  4.1918,  73.5291, 'Indian/Maldives'),
  ('AUH', 'OMAA', 'Zayed International',                'Abu Dhabi',    'AE', 24.4330,  54.6511, 'Asia/Dubai'),
  ('BAH', 'OBBI', 'Bahrain International',              'Manama',       'BH', 26.2708,  50.6336, 'Asia/Bahrain'),
  ('MCT', 'OOMS', 'Muscat International',               'Muscat',       'OM', 23.5933,  58.2844, 'Asia/Muscat'),
  ('KWI', 'OKKK', 'Kuwait International',               'Kuwait City',  'KW', 29.2266,  47.9689, 'Asia/Kuwait'),
  ('RUH', 'OERK', 'King Khalid International',          'Riyadh',       'SA', 24.9576,  46.6988, 'Asia/Riyadh'),
  ('JED', 'OEJN', 'King Abdulaziz International',       'Jeddah',       'SA', 21.6796,  39.1565, 'Asia/Riyadh'),

  -- Oceania, Africa, South America
  ('AKL', 'NZAA', 'Auckland',                           'Auckland',     'NZ',-37.0082, 174.7850, 'Pacific/Auckland'),
  ('CHC', 'NZCH', 'Christchurch',                       'Christchurch', 'NZ',-43.4894, 172.5322, 'Pacific/Auckland'),
  ('BNE', 'YBBN', 'Brisbane',                           'Brisbane',     'AU',-27.3842, 153.1175, 'Australia/Brisbane'),
  ('PER', 'YPPH', 'Perth',                              'Perth',        'AU',-31.9403, 115.9669, 'Australia/Perth'),
  ('CPT', 'FACT', 'Cape Town International',            'Cape Town',    'ZA',-33.9715,  18.6021, 'Africa/Johannesburg'),
  ('NBO', 'HKJK', 'Jomo Kenyatta International',        'Nairobi',      'KE', -1.3192,  36.9278, 'Africa/Nairobi'),
  ('CAI', 'HECA', 'Cairo International',                'Cairo',        'EG', 30.1219,  31.4056, 'Africa/Cairo'),
  ('CMN', 'GMMN', 'Mohammed V International',           'Casablanca',   'MA', 33.3675,  -7.5900, 'Africa/Casablanca'),
  ('GRU', 'SBGR', 'São Paulo–Guarulhos',                'Sao Paulo',    'BR',-23.4356, -46.4731, 'America/Sao_Paulo'),
  ('GIG', 'SBGL', 'Rio de Janeiro–Galeão',              'Rio de Janeiro','BR',-22.8100,-43.2506, 'America/Sao_Paulo'),
  ('EZE', 'SAEZ', 'Ministro Pistarini',                 'Buenos Aires', 'AR',-34.8222, -58.5358, 'America/Argentina/Buenos_Aires'),
  ('SCL', 'SCEL', 'Arturo Merino Benítez',              'Santiago',     'CL',-33.3930, -70.7858, 'America/Santiago'),
  ('BOG', 'SKBO', 'El Dorado International',            'Bogota',       'CO',  4.7016, -74.1469, 'America/Bogota'),
  ('MEX', 'MMMX', 'Mexico City International',          'Mexico City',  'MX', 19.4363, -99.0721, 'America/Mexico_City'),
  ('CUN', 'MMUN', 'Cancún International',               'Cancun',       'MX', 21.0365, -86.8771, 'America/Cancun')
on conflict (iata) do nothing;
