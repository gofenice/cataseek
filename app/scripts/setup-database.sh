#!/bin/bash

# Cataseek Database Setup Script
# This script initializes all required database tables

echo "🚀 Cataseek Database Setup"
echo "========================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with your database credentials."
    exit 1
fi

# Load environment variables
source .env

# Check if required variables are set
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
    echo "❌ Error: Missing required environment variables!"
    echo "Please ensure DB_HOST, DB_USER, DB_NAME, and DB_PASSWORD are set in .env"
    exit 1
fi

echo "📋 Database Configuration:"
echo "   Host: $DB_HOST"
echo "   User: $DB_USER"
echo "   Database: $DB_NAME"
echo ""

# Prompt for confirmation
read -p "⚠️  This will create/recreate all tables. Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Setup cancelled."
    exit 1
fi

echo ""
echo "📦 Running schema.sql..."

# Run the SQL file
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/schema.sql

if [ $? -eq 0 ]; then
    echo "✅ Database tables created successfully!"
    echo ""
    echo "📊 Created tables:"
    echo "   • tenants"
    echo "   • plans"
    echo "   • subscriptions"
    echo "   • api_usage"
    echo ""
    echo "💡 Note: Product tables (products_X) are created dynamically when tenants register."
    echo ""
    echo "🎉 Database setup complete!"
else
    echo "❌ Error running schema.sql"
    exit 1
fi
