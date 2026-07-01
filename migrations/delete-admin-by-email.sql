-- Script to safely delete an admin by email
-- WARNING: This will delete ALL data associated with this admin (properties, tenants, bills, payments, etc.)

-- Step 1: Find the admin by email and show their details
-- Replace 'admin@example.com' with the actual email
SELECT 
    id AS admin_id, 
    email, 
    company_name,
    payment_configured
FROM admin 
WHERE email = 'admin@example.com';

-- Step 2: Preview all data that will be deleted (replace :admin_id with the id from step 1)
-- Uncomment these lines to preview:
/*
-- Properties
SELECT COUNT(*) AS properties_count FROM properties WHERE owner_id = :admin_id;
SELECT * FROM properties WHERE owner_id = :admin_id;

-- Tenants
SELECT COUNT(*) AS tenants_count FROM tenants WHERE owner_id = :admin_id;
SELECT * FROM tenants WHERE owner_id = :admin_id;

-- Bills
SELECT COUNT(*) AS bills_count FROM bills WHERE owner_id = :admin_id;
SELECT * FROM bills WHERE owner_id = :admin_id;

-- Payments
SELECT COUNT(*) AS payments_count FROM payments WHERE owner_id = :admin_id;
SELECT * FROM payments WHERE owner_id = :admin_id;

-- Expenses
SELECT COUNT(*) AS expenses_count FROM expenses WHERE owner_id = :admin_id;
SELECT * FROM expenses WHERE owner_id = :admin_id;

-- Rooms
SELECT COUNT(*) AS rooms_count FROM rooms r 
JOIN properties p ON r.property_id = p.id 
WHERE p.owner_id = :admin_id;
SELECT r.* FROM rooms r 
JOIN properties p ON r.property_id = p.id 
WHERE p.owner_id = :admin_id;
*/

-- Step 3: Delete the admin (cascade will delete all related data)
-- Replace 'admin@example.com' with the actual email
BEGIN;
-- Make sure we found the admin first
WITH admin_to_delete AS (
    SELECT id FROM admin WHERE email = 'admin@example.com'
)
DELETE FROM admin 
WHERE id IN (SELECT id FROM admin_to_delete);

-- If you want to test without committing, uncomment ROLLBACK and comment COMMIT
ROLLBACK;
-- COMMIT;
