-- =============================================================================
-- 0016_airports — the reference data the flight module was missing.
--
-- `flights` has carried `origin_iata`, `origin_lat`, `origin_tz` and their
-- destination twins since 0010, and nothing could fill them. The lookup route
-- resolves a route from AeroDataBox, and with no key configured — which is the
-- documented, supported baseline — every flight saved as `??? → ???`, drew no
-- great circle, and could not compute a meeting time.
--
-- Manual entry is the baseline for this module, so the baseline has to be able
-- to name an airport. That needs a table: an IATA code alone is a label, and
-- the map wants coordinates while the dual-time display wants a zone.
--
-- Reference data, so it is seeded here and written by nobody through the API,
-- exactly like `visa_rules` and `medication_restrictions`. Around 120 airports
-- rather than the full nine thousand: these are the ones this app's users
-- plausibly fly through, the file stays readable, and an unlisted airport is
-- still enterable by code — it just carries no coordinates until somebody adds
-- a row.
-- =============================================================================
create table if not exists public.airports (
  iata         text primary key,
  icao         text,
  name         text not null,
  city         text not null,
  country_code text not null,
  lat          numeric not null,
  lng          numeric not null,
  timezone     text not null,
  created_at   timestamptz not null default now(),
  constraint iata_is_code check (iata ~ '^[A-Z]{3}$')
);

create index if not exists airports_city_idx on public.airports (lower(city));
create index if not exists airports_country_idx on public.airports (country_code);

alter table public.airports enable row level security;

drop policy if exists "signed in read" on public.airports;
create policy "signed in read" on public.airports
  for select using (auth.uid() is not null);

-- =============================================================================
-- Seed.
--
-- Coordinates are the published airport reference points; timezones are IANA
-- names, because a fixed offset is wrong twice a year.
-- =============================================================================
insert into public.airports (iata, icao, name, city, country_code, lat, lng, timezone) values
  -- India
  ('IXE','VOML','Mangaluru International','Mangaluru','IN',12.9613,74.8901,'Asia/Kolkata'),
  ('BOM','VABB','Chhatrapati Shivaji Maharaj International','Mumbai','IN',19.0887,72.8679,'Asia/Kolkata'),
  ('DEL','VIDP','Indira Gandhi International','Delhi','IN',28.5562,77.1000,'Asia/Kolkata'),
  ('BLR','VOBL','Kempegowda International','Bengaluru','IN',13.1986,77.7066,'Asia/Kolkata'),
  ('MAA','VOMM','Chennai International','Chennai','IN',12.9941,80.1709,'Asia/Kolkata'),
  ('HYD','VOHS','Rajiv Gandhi International','Hyderabad','IN',17.2403,78.4294,'Asia/Kolkata'),
  ('COK','VOCI','Cochin International','Kochi','IN',10.1520,76.4019,'Asia/Kolkata'),
  ('CCU','VECC','Netaji Subhas Chandra Bose International','Kolkata','IN',22.6547,88.4467,'Asia/Kolkata'),
  ('GOI','VAGO','Goa International (Dabolim)','Goa','IN',15.3808,73.8314,'Asia/Kolkata'),
  ('AMD','VAAH','Sardar Vallabhbhai Patel International','Ahmedabad','IN',23.0772,72.6347,'Asia/Kolkata'),
  ('PNQ','VAPO','Pune','Pune','IN',18.5793,73.9089,'Asia/Kolkata'),
  ('TRV','VOTV','Trivandrum International','Thiruvananthapuram','IN',8.4821,76.9201,'Asia/Kolkata'),
  ('CCJ','VOCL','Calicut International','Kozhikode','IN',11.1368,75.9553,'Asia/Kolkata'),
  -- Gulf and Middle East
  ('DXB','OMDB','Dubai International','Dubai','AE',25.2532,55.3657,'Asia/Dubai'),
  ('AUH','OMAA','Zayed International','Abu Dhabi','AE',24.4330,54.6511,'Asia/Dubai'),
  ('SHJ','OMSJ','Sharjah International','Sharjah','AE',25.3286,55.5172,'Asia/Dubai'),
  ('DOH','OTHH','Hamad International','Doha','QA',25.2731,51.6081,'Asia/Qatar'),
  ('RUH','OERK','King Khalid International','Riyadh','SA',24.9576,46.6988,'Asia/Riyadh'),
  ('JED','OEJN','King Abdulaziz International','Jeddah','SA',21.6796,39.1565,'Asia/Riyadh'),
  ('KWI','OKKK','Kuwait International','Kuwait City','KW',29.2266,47.9689,'Asia/Kuwait'),
  ('BAH','OBBI','Bahrain International','Manama','BH',26.2708,50.6336,'Asia/Bahrain'),
  ('MCT','OOMS','Muscat International','Muscat','OM',23.5933,58.2844,'Asia/Muscat'),
  ('TLV','LLBG','Ben Gurion','Tel Aviv','IL',32.0114,34.8867,'Asia/Jerusalem'),
  ('AMM','OJAI','Queen Alia International','Amman','JO',31.7226,35.9932,'Asia/Amman'),
  ('IST','LTFM','Istanbul','Istanbul','TR',41.2753,28.7519,'Europe/Istanbul'),
  ('SAW','LTFJ','Sabiha Gokcen','Istanbul','TR',40.8986,29.3092,'Europe/Istanbul'),
  -- United Kingdom and Ireland
  ('LHR','EGLL','Heathrow','London','GB',51.4700,-0.4543,'Europe/London'),
  ('LGW','EGKK','Gatwick','London','GB',51.1537,-0.1821,'Europe/London'),
  ('STN','EGSS','Stansted','London','GB',51.8860,0.2389,'Europe/London'),
  ('LTN','EGGW','Luton','London','GB',51.8747,-0.3683,'Europe/London'),
  ('MAN','EGCC','Manchester','Manchester','GB',53.3654,-2.2728,'Europe/London'),
  ('EDI','EGPH','Edinburgh','Edinburgh','GB',55.9500,-3.3725,'Europe/London'),
  ('BHX','EGBB','Birmingham','Birmingham','GB',52.4539,-1.7480,'Europe/London'),
  ('GLA','EGPF','Glasgow','Glasgow','GB',55.8719,-4.4331,'Europe/London'),
  ('DUB','EIDW','Dublin','Dublin','IE',53.4213,-6.2701,'Europe/Dublin'),
  -- Continental Europe
  ('CDG','LFPG','Charles de Gaulle','Paris','FR',49.0097,2.5479,'Europe/Paris'),
  ('ORY','LFPO','Orly','Paris','FR',48.7233,2.3794,'Europe/Paris'),
  ('AMS','EHAM','Schiphol','Amsterdam','NL',52.3105,4.7683,'Europe/Amsterdam'),
  ('FRA','EDDF','Frankfurt','Frankfurt','DE',50.0379,8.5622,'Europe/Berlin'),
  ('MUC','EDDM','Munich','Munich','DE',48.3538,11.7861,'Europe/Berlin'),
  ('BER','EDDB','Brandenburg','Berlin','DE',52.3667,13.5033,'Europe/Berlin'),
  ('MAD','LEMD','Adolfo Suarez Barajas','Madrid','ES',40.4936,-3.5668,'Europe/Madrid'),
  ('BCN','LEBL','El Prat','Barcelona','ES',41.2974,2.0833,'Europe/Madrid'),
  ('LIS','LPPT','Humberto Delgado','Lisbon','PT',38.7742,-9.1342,'Europe/Lisbon'),
  ('OPO','LPPR','Francisco Sa Carneiro','Porto','PT',41.2481,-8.6814,'Europe/Lisbon'),
  ('FCO','LIRF','Fiumicino','Rome','IT',41.8003,12.2389,'Europe/Rome'),
  ('MXP','LIMC','Malpensa','Milan','IT',45.6306,8.7281,'Europe/Rome'),
  ('VCE','LIPZ','Marco Polo','Venice','IT',45.5053,12.3519,'Europe/Rome'),
  ('NAP','LIRN','Naples','Naples','IT',40.8860,14.2908,'Europe/Rome'),
  ('ATH','LGAV','Eleftherios Venizelos','Athens','GR',37.9364,23.9445,'Europe/Athens'),
  ('ZRH','LSZH','Zurich','Zurich','CH',47.4647,8.5492,'Europe/Zurich'),
  ('GVA','LSGG','Geneva','Geneva','CH',46.2381,6.1089,'Europe/Zurich'),
  ('VIE','LOWW','Vienna','Vienna','AT',48.1103,16.5697,'Europe/Vienna'),
  ('BRU','EBBR','Brussels','Brussels','BE',50.9014,4.4844,'Europe/Brussels'),
  ('CPH','EKCH','Kastrup','Copenhagen','DK',55.6180,12.6508,'Europe/Copenhagen'),
  ('ARN','ESSA','Arlanda','Stockholm','SE',59.6519,17.9186,'Europe/Stockholm'),
  ('OSL','ENGM','Gardermoen','Oslo','NO',60.1976,11.1004,'Europe/Oslo'),
  ('HEL','EFHK','Vantaa','Helsinki','FI',60.3172,24.9633,'Europe/Helsinki'),
  ('KEF','BIKF','Keflavik','Reykjavik','IS',63.9850,-22.6056,'Atlantic/Reykjavik'),
  ('WAW','EPWA','Chopin','Warsaw','PL',52.1657,20.9671,'Europe/Warsaw'),
  ('PRG','LKPR','Vaclav Havel','Prague','CZ',50.1008,14.2600,'Europe/Prague'),
  ('BUD','LHBP','Ferenc Liszt','Budapest','HU',47.4369,19.2556,'Europe/Budapest'),
  ('OTP','LROP','Henri Coanda','Bucharest','RO',44.5711,26.0850,'Europe/Bucharest'),
  ('SOF','LBSF','Sofia','Sofia','BG',42.6952,23.4062,'Europe/Sofia'),
  ('ZAG','LDZA','Franjo Tudman','Zagreb','HR',45.7429,16.0688,'Europe/Zagreb'),
  ('BEG','LYBE','Nikola Tesla','Belgrade','RS',44.8184,20.3091,'Europe/Belgrade'),
  ('KBP','UKBB','Boryspil','Kyiv','UA',50.3450,30.8947,'Europe/Kyiv'),
  -- North America
  ('JFK','KJFK','John F Kennedy International','New York','US',40.6413,-73.7781,'America/New_York'),
  ('EWR','KEWR','Newark Liberty','New York','US',40.6895,-74.1745,'America/New_York'),
  ('LGA','KLGA','LaGuardia','New York','US',40.7769,-73.8740,'America/New_York'),
  ('BOS','KBOS','Logan International','Boston','US',42.3656,-71.0096,'America/New_York'),
  ('IAD','KIAD','Dulles International','Washington','US',38.9531,-77.4565,'America/New_York'),
  ('ATL','KATL','Hartsfield-Jackson','Atlanta','US',33.6407,-84.4277,'America/New_York'),
  ('MIA','KMIA','Miami International','Miami','US',25.7959,-80.2870,'America/New_York'),
  ('ORD','KORD','O''Hare International','Chicago','US',41.9742,-87.9073,'America/Chicago'),
  ('DFW','KDFW','Dallas Fort Worth','Dallas','US',32.8998,-97.0403,'America/Chicago'),
  ('IAH','KIAH','George Bush Intercontinental','Houston','US',29.9902,-95.3368,'America/Chicago'),
  ('DEN','KDEN','Denver International','Denver','US',39.8561,-104.6737,'America/Denver'),
  ('PHX','KPHX','Sky Harbor','Phoenix','US',33.4342,-112.0116,'America/Phoenix'),
  ('LAX','KLAX','Los Angeles International','Los Angeles','US',33.9416,-118.4085,'America/Los_Angeles'),
  ('SFO','KSFO','San Francisco International','San Francisco','US',37.6213,-122.3790,'America/Los_Angeles'),
  ('SEA','KSEA','Seattle-Tacoma','Seattle','US',47.4502,-122.3088,'America/Los_Angeles'),
  ('LAS','KLAS','Harry Reid International','Las Vegas','US',36.0840,-115.1537,'America/Los_Angeles'),
  ('YYZ','CYYZ','Toronto Pearson','Toronto','CA',43.6777,-79.6248,'America/Toronto'),
  ('YUL','CYUL','Montreal-Trudeau','Montreal','CA',45.4706,-73.7408,'America/Toronto'),
  ('YVR','CYVR','Vancouver International','Vancouver','CA',49.1967,-123.1815,'America/Vancouver'),
  ('YYC','CYYC','Calgary International','Calgary','CA',51.1315,-114.0106,'America/Edmonton'),
  ('MEX','MMMX','Benito Juarez','Mexico City','MX',19.4363,-99.0721,'America/Mexico_City'),
  ('CUN','MMUN','Cancun International','Cancun','MX',21.0365,-86.8771,'America/Cancun'),
  -- South America
  ('GRU','SBGR','Guarulhos','Sao Paulo','BR',-23.4356,-46.4731,'America/Sao_Paulo'),
  ('GIG','SBGL','Galeao','Rio de Janeiro','BR',-22.8100,-43.2506,'America/Sao_Paulo'),
  ('EZE','SAEZ','Ezeiza','Buenos Aires','AR',-34.8222,-58.5358,'America/Argentina/Buenos_Aires'),
  ('SCL','SCEL','Arturo Merino Benitez','Santiago','CL',-33.3930,-70.7858,'America/Santiago'),
  ('LIM','SPJC','Jorge Chavez','Lima','PE',-12.0219,-77.1143,'America/Lima'),
  ('BOG','SKBO','El Dorado','Bogota','CO',4.7016,-74.1469,'America/Bogota'),
  -- Africa
  ('CAI','HECA','Cairo International','Cairo','EG',30.1219,31.4056,'Africa/Cairo'),
  ('CMN','GMMN','Mohammed V','Casablanca','MA',33.3675,-7.5899,'Africa/Casablanca'),
  ('RAK','GMMX','Menara','Marrakesh','MA',31.6069,-8.0363,'Africa/Casablanca'),
  ('JNB','FAOR','O R Tambo','Johannesburg','ZA',-26.1392,28.2460,'Africa/Johannesburg'),
  ('CPT','FACT','Cape Town International','Cape Town','ZA',-33.9649,18.6017,'Africa/Johannesburg'),
  ('NBO','HKJK','Jomo Kenyatta','Nairobi','KE',-1.3192,36.9278,'Africa/Nairobi'),
  ('ADD','HAAB','Bole International','Addis Ababa','ET',8.9779,38.7993,'Africa/Addis_Ababa'),
  ('DAR','HTDA','Julius Nyerere','Dar es Salaam','TZ',-6.8781,39.2026,'Africa/Dar_es_Salaam'),
  ('ZNZ','HTZA','Abeid Amani Karume','Zanzibar','TZ',-6.2220,39.2249,'Africa/Dar_es_Salaam'),
  -- South and Southeast Asia
  ('CMB','VCBI','Bandaranaike International','Colombo','LK',7.1808,79.8841,'Asia/Colombo'),
  ('MLE','VRMM','Velana International','Male','MV',4.1918,73.5291,'Indian/Maldives'),
  ('KTM','VNKT','Tribhuvan International','Kathmandu','NP',27.6966,85.3591,'Asia/Kathmandu'),
  ('DAC','VGHS','Hazrat Shahjalal','Dhaka','BD',23.8433,90.3978,'Asia/Dhaka'),
  ('KHI','OPKC','Jinnah International','Karachi','PK',24.9065,67.1608,'Asia/Karachi'),
  ('LHE','OPLA','Allama Iqbal International','Lahore','PK',31.5216,74.4036,'Asia/Karachi'),
  ('ISB','OPIS','Islamabad International','Islamabad','PK',33.5490,72.8256,'Asia/Karachi'),
  ('BKK','VTBS','Suvarnabhumi','Bangkok','TH',13.6900,100.7501,'Asia/Bangkok'),
  ('DMK','VTBD','Don Mueang','Bangkok','TH',13.9126,100.6068,'Asia/Bangkok'),
  ('HKT','VTSP','Phuket International','Phuket','TH',8.1132,98.3169,'Asia/Bangkok'),
  ('SIN','WSSS','Changi','Singapore','SG',1.3644,103.9915,'Asia/Singapore'),
  ('KUL','WMKK','Kuala Lumpur International','Kuala Lumpur','MY',2.7456,101.7099,'Asia/Kuala_Lumpur'),
  ('CGK','WIII','Soekarno-Hatta','Jakarta','ID',-6.1256,106.6559,'Asia/Jakarta'),
  ('DPS','WADD','Ngurah Rai','Bali','ID',-8.7482,115.1672,'Asia/Makassar'),
  ('MNL','RPLL','Ninoy Aquino','Manila','PH',14.5086,121.0198,'Asia/Manila'),
  ('SGN','VVTS','Tan Son Nhat','Ho Chi Minh City','VN',10.8188,106.6520,'Asia/Ho_Chi_Minh'),
  ('HAN','VVNB','Noi Bai','Hanoi','VN',21.2212,105.8072,'Asia/Ho_Chi_Minh'),
  -- East Asia
  ('HKG','VHHH','Hong Kong International','Hong Kong','HK',22.3080,113.9185,'Asia/Hong_Kong'),
  ('PVG','ZSPD','Pudong','Shanghai','CN',31.1443,121.8083,'Asia/Shanghai'),
  ('PEK','ZBAA','Capital','Beijing','CN',40.0799,116.6031,'Asia/Shanghai'),
  ('CAN','ZGGG','Baiyun','Guangzhou','CN',23.3924,113.2988,'Asia/Shanghai'),
  ('TPE','RCTP','Taoyuan','Taipei','TW',25.0777,121.2328,'Asia/Taipei'),
  ('ICN','RKSI','Incheon','Seoul','KR',37.4602,126.4407,'Asia/Seoul'),
  ('NRT','RJAA','Narita','Tokyo','JP',35.7720,140.3929,'Asia/Tokyo'),
  ('HND','RJTT','Haneda','Tokyo','JP',35.5494,139.7798,'Asia/Tokyo'),
  ('KIX','RJBB','Kansai','Osaka','JP',34.4342,135.2328,'Asia/Tokyo'),
  -- Oceania
  ('SYD','YSSY','Kingsford Smith','Sydney','AU',-33.9399,151.1753,'Australia/Sydney'),
  ('MEL','YMML','Tullamarine','Melbourne','AU',-37.6690,144.8410,'Australia/Melbourne'),
  ('BNE','YBBN','Brisbane','Brisbane','AU',-27.3842,153.1175,'Australia/Brisbane'),
  ('PER','YPPH','Perth','Perth','AU',-31.9403,115.9670,'Australia/Perth'),
  ('AKL','NZAA','Auckland','Auckland','NZ',-37.0082,174.7850,'Pacific/Auckland')
on conflict (iata) do nothing;
