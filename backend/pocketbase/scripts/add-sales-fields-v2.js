#!/usr/bin/env node

/**
 * Script to add missing fields to PocketBase sales collection (v2)
 * Fixed to use proper PocketBase API format
 */

const http = require('http');

const POCKETBASE_URL = 'http://localhost:8090';
const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = process.argv[3];

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Usage: node add-sales-fields-v2.js <admin-email> <admin-password>');
  process.exit(1);
}

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
          if (res.statusCode < 400) {
            resolve({ statusCode: res.statusCode, data: body });
          } else {
            reject(new Error(`Failed to parse response: ${body}`));
          }
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

// Generate a unique field ID (8 characters alphanumeric)
function generateFieldId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function main() {
  console.log('🔐 Authenticating as admin...');

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
    process.exit(1);
  }

  console.log('\n📋 Fetching current sales collection...');

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

  console.log('\n➕ Preparing new fields...');

  const newFields = [
    {
      system: false,
      id: generateFieldId(),
      name: 'transcript',
      type: 'json',
      required: false,
      presentable: false,
      unique: false,
      options: {
        maxSize: 2000000
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'recording_url',
      type: 'url',
      required: false,
      presentable: false,
      unique: false,
      options: {
        exceptDomains: [],
        onlyDomains: []
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'analysis',
      type: 'json',
      required: false,
      presentable: false,
      unique: false,
      options: {
        maxSize: 2000000
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'performance_report',
      type: 'json',
      required: false,
      presentable: false,
      unique: false,
      options: {
        maxSize: 2000000
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'success_probability',
      type: 'number',
      required: false,
      presentable: false,
      unique: false,
      options: {
        min: 0,
        max: 100,
        noDecimal: false
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'duration',
      type: 'number',
      required: false,
      presentable: false,
      unique: false,
      options: {
        min: 0,
        max: null,
        noDecimal: false
      }
    },
    {
      system: false,
      id: generateFieldId(),
      name: 'notes',
      type: 'text',
      required: false,
      presentable: false,
      unique: false,
      options: {
        min: null,
        max: null,
        pattern: ''
      }
    }
  ];

  const existingFieldNames = currentCollection.schema.map(f => f.name);
  const fieldsToAdd = newFields.filter(f => !existingFieldNames.includes(f.name));

  if (fieldsToAdd.length === 0) {
    console.log('✅ All fields already exist!');
    return;
  }

  console.log(`   Adding ${fieldsToAdd.length} fields:`, fieldsToAdd.map(f => f.name).join(', '));

  const updatedSchema = [...currentCollection.schema, ...fieldsToAdd];

  console.log('\n💾 Updating collection schema...');

  const updateOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/collections/' + currentCollection.id,
    method: 'PATCH',
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json',
    }
  };

  const updateData = {
    name: currentCollection.name,
    type: currentCollection.type,
    schema: updatedSchema,
    listRule: currentCollection.listRule,
    viewRule: currentCollection.viewRule,
    createRule: currentCollection.createRule,
    updateRule: currentCollection.updateRule,
    deleteRule: currentCollection.deleteRule,
  };

  try {
    await makeRequest(updateOptions, updateData);
    console.log('\n🎉 SUCCESS! All fields added to sales collection!\n');
    console.log('📊 Sales collection now has:', updatedSchema.length, 'total fields\n');
    console.log('✅ Your database can now store:');
    console.log('   • Call recordings (recording_url)');
    console.log('   • Conversation transcripts (transcript)');
    console.log('   • AI analysis (analysis)');
    console.log('   • Performance reports (performance_report)');
    console.log('   • Success predictions (success_probability)');
    console.log('   • Call duration (duration)');
    console.log('   • Additional notes (notes)\n');
    console.log('✅ All data can be retrieved by authorized users!');
  } catch (error) {
    console.error('❌ Failed to update collection:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
