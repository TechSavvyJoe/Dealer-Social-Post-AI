#!/usr/bin/env node

/**
 * Script to fix PocketBase collection permissions for user management
 */

const http = require('http');

const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = process.argv[3];

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Usage: node fix-permissions.js <admin-email> <admin-password>');
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
          resolve({ statusCode: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function updateCollection(authToken, collectionId, updates) {
  const options = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/collections/' + collectionId,
    method: 'PATCH',
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json',
    }
  };

  return await makeRequest(options, updates);
}

async function main() {
  console.log('🔐 Authenticating...');

  const authOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/admins/auth-with-password',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };

  let authToken;
  try {
    const authResult = await makeRequest(authOptions, {
      identity: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    authToken = authResult.data.token;
    console.log('✅ Authenticated!\n');
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }

  console.log('📋 Getting collections...');

  const getCollectionsOptions = {
    hostname: 'localhost',
    port: 8090,
    path: '/api/collections',
    method: 'GET',
    headers: { 'Authorization': authToken }
  };

  let collections;
  try {
    const result = await makeRequest(getCollectionsOptions);
    collections = result.data.items;
    console.log(`✅ Found ${collections.length} collections\n`);
  } catch (error) {
    console.error('❌ Failed to get collections:', error.message);
    process.exit(1);
  }

  // Find collection IDs
  const usersCollection = collections.find(c => c.name === 'users');
  const salespeopleCollection = collections.find(c => c.name === 'salespeople');
  const salesCollection = collections.find(c => c.name === 'sales');
  const liveSalesCollection = collections.find(c => c.name === 'live_sales');

  console.log('🔧 Updating permissions...\n');

  // Update USERS collection
  if (usersCollection) {
    console.log('👥 Updating users collection...');
    try {
      await updateCollection(authToken, usersCollection.id, {
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != "" && (@request.auth.id = id || @request.auth.role = "manager")',
        createRule: '', // Allow anyone to create (self-registration)
        updateRule: '@request.auth.id != "" && (@request.auth.id = id || @request.auth.role = "manager")',
        deleteRule: '@request.auth.role = "manager"'
      });
      console.log('   ✅ Users: Anyone can register, users can update self, managers can do all');
    } catch (error) {
      console.error('   ❌ Failed:', error.message);
    }
  }

  // Update SALESPEOPLE collection
  if (salespeopleCollection) {
    console.log('👔 Updating salespeople collection...');
    try {
      await updateCollection(authToken, salespeopleCollection.id, {
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != "" && (@request.auth.role = "manager" || user_id = @request.auth.id)',
        createRule: '@request.auth.role = "manager"',
        updateRule: '@request.auth.role = "manager"',
        deleteRule: '@request.auth.role = "manager"'
      });
      console.log('   ✅ Salespeople: All authenticated can list, view own profile, managers manage all');
    } catch (error) {
      console.error('   ❌ Failed:', error.message);
    }
  }

  // Update SALES collection (already has rules, but let's ensure they're correct)
  if (salesCollection) {
    console.log('💰 Updating sales collection...');
    try {
      await updateCollection(authToken, salesCollection.id, {
        listRule: '@request.auth.id != "" && (@request.auth.role = "manager" || salesperson.user_id = @request.auth.id)',
        viewRule: '@request.auth.id != "" && (@request.auth.role = "manager" || salesperson.user_id = @request.auth.id)',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.role = "manager"',
        deleteRule: '@request.auth.role = "manager"'
      });
      console.log('   ✅ Sales: Any auth user can create, view own, managers manage all');
    } catch (error) {
      console.error('   ❌ Failed:', error.message);
    }
  }

  // Update LIVE_SALES collection
  if (liveSalesCollection) {
    console.log('📞 Updating live_sales collection...');
    try {
      await updateCollection(authToken, liveSalesCollection.id, {
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != "" && (@request.auth.role = "manager" || salesperson_id.user_id = @request.auth.id)',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != "" && (@request.auth.role = "manager" || salesperson_id.user_id = @request.auth.id)',
        deleteRule: '@request.auth.role = "manager"'
      });
      console.log('   ✅ Live Sales: All can see list, view/edit own, managers manage all');
    } catch (error) {
      console.error('   ❌ Failed:', error.message);
    }
  }

  console.log('\n🎉 Permissions updated successfully!\n');
  console.log('📊 Summary of Access Rights:\n');
  console.log('👥 USERS:');
  console.log('   • Anyone can register (self-signup)');
  console.log('   • Users can view and edit their own profile');
  console.log('   • Managers can view, edit, and delete any user\n');

  console.log('👔 SALESPEOPLE:');
  console.log('   • All authenticated users can see list');
  console.log('   • Users can view their own salesperson profile');
  console.log('   • Only managers can create, edit, delete\n');

  console.log('💰 SALES:');
  console.log('   • Any authenticated user can create sales records');
  console.log('   • Users can view their own sales');
  console.log('   • Managers can view all sales and manage them\n');

  console.log('📞 LIVE SALES:');
  console.log('   • Any authenticated user can create/start live sales');
  console.log('   • Users can view and update their own live sales');
  console.log('   • Managers can view and manage all live sales\n');

  console.log('✅ Your app UI can now manage users properly!');
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
