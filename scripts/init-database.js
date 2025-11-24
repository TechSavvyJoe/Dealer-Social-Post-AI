#!/usr/bin/env node

/**
 * Database Initialization Script
 *
 * This script initializes the PocketBase database with:
 * 1. Admin account (code: 0000)
 * 2. Optional test dealer accounts
 *
 * Usage: node scripts/init-database.js
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const pb = new PocketBase(PB_URL);

const COLLECTION_NAME = 'dealers';

async function ensureCollection() {
    console.log('Checking if dealers collection exists...');

    try {
        await pb.collections.getOne(COLLECTION_NAME);
        console.log('✓ Dealers collection already exists');
        return true;
    } catch (error) {
        console.log('Creating dealers collection...');

        try {
            await pb.collections.create({
                name: COLLECTION_NAME,
                type: 'base',
                schema: [
                    {
                        name: 'name',
                        type: 'text',
                        required: true,
                    },
                    {
                        name: 'code',
                        type: 'text',
                        required: true,
                        options: {
                            min: 4,
                            max: 4,
                            pattern: '^[0-9]{4}$',
                        },
                    },
                    {
                        name: 'logo',
                        type: 'url',
                        required: false,
                    },
                    {
                        name: 'logo_file',
                        type: 'file',
                        required: false,
                        options: {
                            maxSelect: 1,
                            maxSize: 5242880, // 5MB
                            mimeTypes: ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif'],
                        },
                    },
                ],
                indexes: [
                    'CREATE UNIQUE INDEX idx_unique_code ON dealers (code)',
                ],
            });
            console.log('✓ Dealers collection created successfully');
            return true;
        } catch (createError) {
            console.error('Error creating collection:', createError);
            return false;
        }
    }
}

async function createDealer(code, name, logo = null) {
    try {
        // Check if dealer with this code already exists
        try {
            const existing = await pb.collection(COLLECTION_NAME).getFirstListItem(`code="${code}"`);
            console.log(`  ↳ Dealer "${name}" (code: ${code}) already exists`);
            return existing;
        } catch (e) {
            // Dealer doesn't exist, create it
        }

        const dealer = await pb.collection(COLLECTION_NAME).create({
            name,
            code,
            logo,
        });

        console.log(`✓ Created dealer: "${name}" with code: ${code}`);
        return dealer;
    } catch (error) {
        console.error(`✗ Failed to create dealer "${name}":`, error.message);
        return null;
    }
}

async function initializeDatabase() {
    console.log('==========================================');
    console.log('Database Initialization');
    console.log('==========================================');
    console.log(`PocketBase URL: ${PB_URL}`);
    console.log('');

    // Wait for PocketBase to be ready
    console.log('Waiting for PocketBase to be ready...');
    let retries = 0;
    while (retries < 10) {
        try {
            await pb.health.check();
            console.log('✓ PocketBase is ready');
            break;
        } catch (e) {
            retries++;
            if (retries >= 10) {
                console.error('✗ PocketBase is not responding. Make sure it\'s running on', PB_URL);
                process.exit(1);
            }
            console.log(`  Retrying... (${retries}/10)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    console.log('');

    // Ensure collection exists
    const collectionReady = await ensureCollection();
    if (!collectionReady) {
        console.error('✗ Failed to create dealers collection');
        process.exit(1);
    }
    console.log('');

    // Create default dealers
    console.log('Creating default dealers...');

    // Admin account
    await createDealer('0000', 'Admin', null);

    // Example test dealers (uncomment if needed)
    // await createDealer('1234', 'Golden Rule Car Co.', null);
    // await createDealer('5678', 'Main Street Motors', null);

    console.log('');
    console.log('==========================================');
    console.log('✓ Database initialization complete!');
    console.log('==========================================');
    console.log('');
    console.log('You can now log in with:');
    console.log('  Admin access: 0000');
    console.log('');
    console.log('From the admin panel, you can:');
    console.log('  • Create new dealer accounts');
    console.log('  • Manage existing dealers');
    console.log('  • Upload dealer logos');
    console.log('');
}

// Run the initialization
initializeDatabase().catch((error) => {
    console.error('Fatal error during initialization:', error);
    process.exit(1);
});
