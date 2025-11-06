#!/usr/bin/env node

/**
 * Script to add missing fields to PocketBase sales collection
 * Run with: node add-sales-fields.js
 */

const http = require('http');

// Configuration
const POCKETBASE_URL = 'http://localhost:8090';
const ADMIN_EMAIL = process.argv[2]; // Pass as first argument
const ADMIN_PASSWORD = process.argv[3]; // Pass as second argument

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Usage: node add-sales-fields.js <admin-email> <admin-password>');
  console.error('   Example: node add-sales-fields.js admin@example.com your-password');
  process.exit(1);
}

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${json.message || body}`));
          } else {
            resolve({ statusCode: res.statusCode, data: json });
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function main() {
  console.log('🔐 Authenticating as admin...');

  // Step 1: Authenticate as admin
  const authOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/admins/auth-with-password',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const authData = {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  };

  let authToken;
  try {
    const authResult = await makeRequest(authOptions, authData);
    authToken = authResult.data.token;
    console.log('✅ Authenticated successfully!');
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    console.error('   Make sure you created an admin account in PocketBase');
    console.error('   Go to: http://localhost:8090/_/ to create one');
    process.exit(1);
  }

  // Step 2: Get current sales collection schema
  console.log('\n📋 Fetching current sales collection schema...');

  const getCollectionOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/collections/sales',
    method: 'GET',
    headers: {
      'Authorization': authToken,
    }
  };

  let currentCollection;
  try {
    const result = await makeRequest(getCollectionOptions);
    currentCollection = result.data;
    console.log('✅ Current collection has', currentCollection.schema.length, 'fields');
  } catch (error) {
    console.error('❌ Failed to fetch collection:', error.message);
    process.exit(1);
  }

  // Step 3: Add new fields to schema
  console.log('\n➕ Adding new fields...');

  const newFields = [
    {
      name: 'transcript',
      type: 'json',
      required: false,
      options: {}
    },
    {
      name: 'recording_url',
      type: 'url',
      required: false,
      options: {
        exceptDomains: [],
        onlyDomains: []
      }
    },
    {
      name: 'analysis',
      type: 'json',
      required: false,
      options: {}
    },
    {
      name: 'performance_report',
      type: 'json',
      required: false,
      options: {}
    },
    {
      name: 'success_probability',
      type: 'number',
      required: false,
      options: {
        min: 0,
        max: 100,
        noDecimal: false
      }
    },
    {
      name: 'duration',
      type: 'number',
      required: false,
      options: {
        min: 0,
        max: null,
        noDecimal: false
      }
    },
    {
      name: 'notes',
      type: 'text',
      required: false,
      options: {
        min: null,
        max: null,
        pattern: ''
      }
    }
  ];

  // Check which fields already exist
  const existingFieldNames = currentCollection.schema.map(f => f.name);
  const fieldsToAdd = newFields.filter(f => !existingFieldNames.includes(f.name));

  if (fieldsToAdd.length === 0) {
    console.log('✅ All fields already exist! Nothing to add.');
    return;
  }

  console.log(`   Adding ${fieldsToAdd.length} new fields:`, fieldsToAdd.map(f => f.name).join(', '));

  // Combine existing schema with new fields
  const updatedSchema = [...currentCollection.schema, ...fieldsToAdd];

  // Step 4: Update collection with new schema
  const updateOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/collections/sales',
    method: 'PATCH',
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json',
    }
  };

  const updateData = {
    schema: updatedSchema
  };

  try {
    await makeRequest(updateOptions, updateData);
    console.log('\n✅ SUCCESS! All fields added to sales collection!');
    console.log('\n📊 Sales collection now has:', updatedSchema.length, 'fields');
    console.log('\n🎉 Your database is ready to store:');
    console.log('   • Call recordings (recording_url)');
    console.log('   • Conversation transcripts (transcript)');
    console.log('   • AI analysis (analysis)');
    console.log('   • Performance reports (performance_report)');
    console.log('   • Success predictions (success_probability)');
    console.log('   • Call duration (duration)');
    console.log('   • Additional notes (notes)');
    console.log('\n✅ Anyone with proper permissions can now view and retrieve this data!');
  } catch (error) {
    console.error('❌ Failed to update collection:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
