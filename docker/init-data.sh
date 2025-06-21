#!/bin/bash
set -e

# Create n8n user and database if they don't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create n8n user if not exists
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$POSTGRES_NON_ROOT_USER') THEN
            CREATE USER $POSTGRES_NON_ROOT_USER WITH PASSWORD '$POSTGRES_NON_ROOT_PASSWORD';
        END IF;
    END
    \$\$;

    -- Grant privileges
    GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_NON_ROOT_USER;
    GRANT ALL ON SCHEMA public TO $POSTGRES_NON_ROOT_USER;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $POSTGRES_NON_ROOT_USER;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $POSTGRES_NON_ROOT_USER;
    
    -- Set default privileges for future objects
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $POSTGRES_NON_ROOT_USER;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $POSTGRES_NON_ROOT_USER;
EOSQL

echo "Database initialization completed successfully!"