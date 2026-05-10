alter table properties add column if not exists latitude double precision;
alter table properties add column if not exists longitude double precision;

create index if not exists properties_geo_idx on properties (latitude, longitude);
