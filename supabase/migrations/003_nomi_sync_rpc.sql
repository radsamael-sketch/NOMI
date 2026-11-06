-- NOMI record-level Last Write Wins RPC.
-- Run once in Supabase SQL Editor; safe to re-run.
create or replace function public.nomi_apply_record(
    p_store_name text,
    p_record_id text,
    p_payload jsonb,
    p_client_updated_at timestamptz,
    p_device_id text,
    p_deleted_at timestamptz default null
)
returns public.nomi_records
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user_id uuid;
    v_result public.nomi_records;
begin
    v_user_id := auth.uid();
    if v_user_id is null then raise exception 'Authentication required'; end if;
    if p_store_name not in ('tasks','planner_entries','planner_notes','events','journal','ideas','books') then
        raise exception 'Unsupported NOMI store';
    end if;
    if p_record_id is null or p_record_id = '' or p_payload is null or p_client_updated_at is null then
        raise exception 'Required record fields are missing';
    end if;

    insert into public.nomi_records (
        user_id, store_name, record_id, payload, updated_at,
        client_updated_at, server_updated_at, revision, device_id, deleted_at
    ) values (
        v_user_id, p_store_name, p_record_id, p_payload, now(),
        p_client_updated_at, now(), 1, p_device_id, p_deleted_at
    )
    on conflict (user_id, store_name, record_id)
    do update set
        payload = excluded.payload,
        updated_at = now(),
        client_updated_at = excluded.client_updated_at,
        server_updated_at = now(),
        revision = nomi_records.revision + 1,
        device_id = excluded.device_id,
        deleted_at = excluded.deleted_at
    where excluded.client_updated_at > nomi_records.client_updated_at
       or (excluded.client_updated_at = nomi_records.client_updated_at
           and coalesce(excluded.device_id, '') > coalesce(nomi_records.device_id, ''))
    returning * into v_result;

    if not found then
        select * into v_result from public.nomi_records
        where user_id = v_user_id and store_name = p_store_name and record_id = p_record_id;
    end if;
    return v_result;
end;
$$;

revoke all on function public.nomi_apply_record(text,text,jsonb,timestamptz,text,timestamptz) from public, anon;
grant execute on function public.nomi_apply_record(text,text,jsonb,timestamptz,text,timestamptz) to authenticated;
