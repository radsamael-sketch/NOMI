-- NOMI v1.5.0: окончательное удаление ранее синхронизированных финансовых записей.
-- Выполнять после 001_nomi_cloud_schema.sql в SQL Editor Supabase.
-- В старой версии финансовые данные хранились в универсальной таблице nomi_records.

delete from public.nomi_records
where store_name in ('transactions', 'finance_categories', 'budgets');
