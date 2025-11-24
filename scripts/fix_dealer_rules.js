import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables.');
    process.exit(1);
}

const pb = new PocketBase(PB_URL);

async function fixApiRules() {
    try {
        console.log(`Connecting to ${PB_URL}...`);
        await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        console.log('✅ Authenticated.');

        const collection = await pb.collections.getOne('dealers');
        console.log('✅ Found dealers collection.');

        // Just update the collection object with all its current data plus new rules
        const updatedCollection = {
            ...collection,
            listRule: "",
            viewRule: "",
        };
        
        // Remove fields that shouldn't be in the update
        delete updatedCollection.id;
        delete updatedCollection.created;
        delete updatedCollection.updated;

        await pb.collections.update(collection.id, updatedCollection);
        console.log('✅ API rules updated successfully!');
        console.log('\n🎉 All done! You can now login with these codes:');
        console.log('   - 0000: Admin Control');
        console.log('   - 1111: Golden Rule Car Co.');
        console.log('   - 2222: LaFontaine Ford');
        console.log('   - 3333: Bob Maxey Ford');
        console.log('   - 4444: Mission Ford of Dearborn');

    } catch (err) {
        console.error('❌ Failed:', err);
        if (err.response) {
            console.error('Response:', err.response);
        }
    }
}

fixApiRules();
