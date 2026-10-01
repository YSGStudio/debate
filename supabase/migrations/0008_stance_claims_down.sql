-- debate_sessions 가 이미 없으면(0001_down 뒤) 되돌릴 필요가 없다.
alter table if exists debate_sessions drop column if exists pro_claim;
alter table if exists debate_sessions drop column if exists con_claim;
