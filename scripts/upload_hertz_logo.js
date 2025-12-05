#!/usr/bin/env node
/**
 * Script to upload a logo for the Hertz dealer
 * Run this after deploying to update the dealer's logo via API
 * 
 * Usage: node scripts/upload_hertz_logo.js
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'https://dealer-social-post-ai-production.fly.dev';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

async function main() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.error('Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables');
        console.log('Example:');
        console.log('  PB_ADMIN_EMAIL=your@email.com PB_ADMIN_PASSWORD=yourpass node scripts/upload_hertz_logo.js');
        process.exit(1);
    }

    try {
        // 1. Authenticate as admin
        console.log('Authenticating with PocketBase...');
        const authResponse = await fetch(`${POCKETBASE_URL}/api/admins/auth-with-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identity: ADMIN_EMAIL,
                password: ADMIN_PASSWORD
            })
        });

        if (!authResponse.ok) {
            const error = await authResponse.text();
            throw new Error(`Auth failed: ${error}`);
        }

        const authData = await authResponse.json();
        const token = authData.token;
        console.log('✓ Authenticated successfully');

        // 2. Find Hertz dealer
        console.log('Finding Hertz dealer...');
        const dealersResponse = await fetch(
            `${POCKETBASE_URL}/api/collections/dealers/records?filter=(code='0001')`,
            { headers: { 'Authorization': token } }
        );

        const dealersData = await dealersResponse.json();
        if (!dealersData.items || dealersData.items.length === 0) {
            throw new Error('Hertz dealer (code 0001) not found');
        }

        const hertzDealer = dealersData.items[0];
        console.log(`✓ Found Hertz dealer: ${hertzDealer.name} (ID: ${hertzDealer.id})`);

        // 3. Read logo file
        const logoPath = path.join(__dirname, '..', 'public', 'logos', 'hertz-car-sales.png');
        if (!fs.existsSync(logoPath)) {
            throw new Error(`Logo file not found at: ${logoPath}`);
        }

        console.log('Uploading logo...');
        
        // 4. Upload logo using FormData
        const logoBuffer = fs.readFileSync(logoPath);
        const blob = new Blob([logoBuffer], { type: 'image/png' });
        
        const formData = new FormData();
        formData.append('logo', blob, 'hertz-car-sales.png');

        const updateResponse = await fetch(
            `${POCKETBASE_URL}/api/collections/dealers/records/${hertzDealer.id}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': token
                },
                body: formData
            }
        );

        if (!updateResponse.ok) {
            const error = await updateResponse.text();
            throw new Error(`Update failed: ${error}`);
        }

        const updated = await updateResponse.json();
        console.log('✓ Logo uploaded successfully!');
        console.log(`  Logo filename: ${updated.logo}`);
        console.log(`  Full URL: ${POCKETBASE_URL}/api/files/dealers/${updated.id}/${updated.logo}`);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
