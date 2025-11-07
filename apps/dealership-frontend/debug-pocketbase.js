// PocketBase Debug Script - Run this in browser console when logged in
// This will show you what data is actually available

console.log('🔍 PocketBase Data Debug Tool');
console.log('============================\n');

async function debugPocketBase() {
    const pb = window.pb || (await import('./src/services/pocketbaseClient.ts')).pb;
    
    console.log('📊 Checking Authentication:');
    console.log('Auth Valid:', pb.authStore.isValid);
    console.log('Current User:', pb.authStore.model);
    console.log('');
    
    try {
        console.log('📋 Fetching Users Collection:');
        const users = await pb.collection('users').getFullList();
        console.log(`Found ${users.length} users:`);
        users.forEach(u => {
            console.log(`  - ${u.email} (${u.role}) [ID: ${u.id}]`);
        });
        console.log('');
    } catch (err) {
        console.error('❌ Users fetch failed:', err.message);
        console.log('');
    }
    
    try {
        console.log('👥 Fetching Salespeople Collection:');
        const salespeople = await pb.collection('salespeople').getFullList({
            expand: 'user_id'
        });
        console.log(`Found ${salespeople.length} salespeople:`);
        salespeople.forEach(s => {
            console.log(`  - ${s.name} [ID: ${s.id}]`);
            console.log(`    User ID: ${s.user_id}`);
            if (s.expand?.user_id) {
                console.log(`    Linked User: ${s.expand.user_id.email} (${s.expand.user_id.role})`);
            } else {
                console.log(`    ⚠️  No linked user found!`);
            }
        });
        console.log('');
    } catch (err) {
        console.error('❌ Salespeople fetch failed:', err.message);
        console.log('');
    }
    
    console.log('💡 Analysis:');
    console.log('If Jose appears in salespeople but not in users:');
    console.log('  → Jose needs a user account created');
    console.log('  → Use Team Management → Add User to create one');
    console.log('  → Then link it by updating the salesperson record');
    console.log('');
    console.log('If Jose appears in users but not in UserManagement:');
    console.log('  → Check API rules in PocketBase Admin');
    console.log('  → Verify ListRule allows managers to see all users');
}

debugPocketBase().catch(console.error);
